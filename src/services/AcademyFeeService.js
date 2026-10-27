// src/services/AcademyFeeService.js
//
// PAGAR A MENSALIDADE DA ACADEMIA PELA FREELANDOO (mig 310).
//
// Decisão do Alex (2026-10-27): o Mercado Pago da Freelandoo recebe o valor
// exato da cobrança; a Freelandoo fica com a tarifa REAL do Mercado Pago +
// R$ 2,50; o resto é repassado por PIX à chave que a academia cadastrou (pode
// ser uma conta Asaas). O PIX é MANUAL: depois do holdback o admin faz e marca
// pago — o Mercado Pago não tem API aberta de PIX de saída para conta qualquer.
//
// ─── A ACADEMIA PRECISA SABER QUE RECEBEU ───────────────────────────────────
//
// A cobrança mora no sistema DELA (o Coliseu cobra pelo Asaas). Pagar aqui sem
// avisar lá deixaria a cobrança aberta, o boleto do Asaas valendo e o aluno
// recebendo lembrete — podendo pagar duas vezes. Por isso:
//   - o "Pagar" só aparece quando a API dela diz `supports_paid_callback`;
//   - o valor é RECONFERIDO na API dela na hora (o espelho pode ter 10 min);
//   - a baixa (`POST payments/:id/paid`) é tentada na hora e, sem resposta,
//     pelo varredor até dar certo;
//   - estorno ANTES do repasse reabre a cobrança lá (`reopened`).
const pool = require("../databases");
const AcademyStorage = require("../storages/AcademyStorage");
const AcademyFeeStorage = require("../storages/AcademyFeeStorage");
const NotificationService = require("./NotificationService");
const PaymentGateway = require("../integrations/payments");
const { providerOf } = require("../integrations/payments/contract");
const gymProvider = require("../integrations/gymProvider");
const secretBox = require("../utils/secretBox");
const { isFullRefund } = require("../utils/refunds");
const { estimateProcessorFee } = require("../utils/deliveryPricing");
const { splitFee, PIX_TYPES, normalizePixKey, hintOf, digits } = require("../utils/academyFee");
const { isValidCPF, isValidCNPJ } = require("../utils/documents");
const { createLogger, runWithLogs } = require("../utils/logger");
const realtime = require("../realtime/socket");

const log = createLogger("AcademyFeeService");

const PAYABLE = ["pending", "overdue"];

function frontendUrl() {
  return String(process.env.FRONTEND_URL || "https://freelandoo.com.br").replace(/\/$/, "");
}

function push(id_user, payload) {
  try {
    if (id_user) realtime.emitToUser(String(id_user), "academy-fee:changed", payload);
  } catch {
    /* realtime é best-effort */
  }
}

function tokenOf(academy) {
  try {
    return secretBox.open(academy.api_token_enc);
  } catch {
    return null;
  }
}

class AcademyFeeService {
  /* ─────────────────────────────── gate ─────────────────────────────── */

  /** As três condições do "Pagar" (sem contar a situação da cobrança). */
  static async payEnabled(academy) {
    if (!academy || academy.is_active === false || academy.pay_callback !== true) return false;
    const [settings, account] = await Promise.all([
      AcademyFeeStorage.getSettings(pool),
      AcademyFeeStorage.getAccount(pool, academy.id_academy),
    ]);
    return settings.is_active && !!account;
  }

  /** { [external_id]: { status, checkout_url } } — pedidos vivos do aluno. */
  static async openOrdersForMember(id_member) {
    const rows = await AcademyFeeStorage.openOrdersForMember(pool, id_member);
    const out = {};
    for (const r of rows) {
      out[r.external_id] = {
        status: r.status,
        // A URL só serve enquanto o pedido espera pagamento.
        checkout_url: r.status === "pending" ? r.checkout_url : null,
      };
    }
    return out;
  }

  /* ──────────────────────── conta de recebimento ─────────────────────── */

  static async _ownedAcademy(id_user, id_academy) {
    const academy = await AcademyStorage.getById(pool, id_academy);
    if (!academy) return { error: "Academia não encontrada", statusCode: 404 };
    if (String(academy.id_owner_user) !== String(id_user)) {
      return { error: "Só o dono da academia mexe nos recebimentos.", statusCode: 403 };
    }
    return { academy };
  }

  /** Mascarado: nunca devolve a chave nem o documento inteiros. */
  static _publicAccount(acc) {
    if (!acc) return null;
    return {
      pix_key_type: acc.pix_key_type,
      pix_key_hint: acc.pix_key_hint,
      holder_name: acc.holder_name,
      holder_doc_type: acc.holder_doc_type,
      holder_doc_hint: acc.holder_doc_hint,
      updated_at: acc.updated_at,
    };
  }

  static async getAccount(user, id_academy) {
    return runWithLogs(log, "getAccount", () => ({ id_user: user?.id_user, id_academy }), async () => {
      const owned = await this._ownedAcademy(user.id_user, id_academy);
      if (owned.error) return owned;
      const [acc, settings] = await Promise.all([
        AcademyFeeStorage.getAccount(pool, id_academy),
        AcademyFeeStorage.getSettings(pool),
      ]);
      return {
        account: this._publicAccount(acc),
        pay_callback: owned.academy.pay_callback === true,
        platform_fee_cents: settings.platform_fee_cents,
        holdback_days: settings.holdback_days,
      };
    });
  }

  /**
   * O titular é o DONO (CPF da conta dele — regra "CPF do repasse = CPF da
   * conta") ou a ACADEMIA (CNPJ). Um CPF de terceiro aqui seria o caminho para
   * desviar o dinheiro dos alunos para outra pessoa.
   */
  static async putAccount(user, id_academy, body) {
    return runWithLogs(log, "putAccount", () => ({ id_user: user?.id_user, id_academy }), async () => {
      const owned = await this._ownedAcademy(user.id_user, id_academy);
      if (owned.error) return owned;

      const type = String(body?.pix_key_type || "");
      if (!PIX_TYPES.includes(type)) return { error: "Tipo de chave PIX inválido.", statusCode: 400 };
      const pix = normalizePixKey(type, body?.pix_key);
      if (pix.error) return { error: pix.error, statusCode: 400 };

      const holderName = String(body?.holder_name || "").trim().slice(0, 120);
      if (holderName.length < 3) return { error: "Informe o nome do titular.", statusCode: 400 };

      const doc = digits(body?.holder_doc);
      let docType;
      if (doc.length === 11) {
        if (!isValidCPF(doc)) return { error: "CPF do titular inválido.", statusCode: 400 };
        const r = await pool.query(`SELECT cpf FROM public.tb_user WHERE id_user = $1`, [user.id_user]);
        if (!r.rows[0]?.cpf || r.rows[0].cpf !== doc) {
          return {
            error: "O CPF do titular tem que ser o CPF da sua conta. Para outra pessoa, use o CNPJ da academia.",
            statusCode: 400,
          };
        }
        docType = "cpf";
      } else if (doc.length === 14) {
        if (!isValidCNPJ(doc)) return { error: "CNPJ do titular inválido.", statusCode: 400 };
        docType = "cnpj";
      } else {
        return { error: "Informe o CPF ou o CNPJ do titular.", statusCode: 400 };
      }

      const saved = await AcademyFeeStorage.upsertAccount(pool, {
        id_academy,
        pix_key_type: type,
        pix_key_sealed: secretBox.seal(pix.key),
        pix_key_hint: hintOf(pix.key),
        holder_name: holderName,
        holder_doc_type: docType,
        holder_doc_sealed: secretBox.seal(doc),
        holder_doc_hint: hintOf(doc),
        updated_by: user.id_user,
      });
      log.info("account.saved", { id_academy, pix_key_type: type, holder_doc_type: docType });
      return { account: this._publicAccount(saved) };
    });
  }

  static async deleteAccount(user, id_academy) {
    return runWithLogs(log, "deleteAccount", () => ({ id_user: user?.id_user, id_academy }), async () => {
      const owned = await this._ownedAcademy(user.id_user, id_academy);
      if (owned.error) return owned;
      await AcademyFeeStorage.deleteAccount(pool, id_academy);
      return { account: null };
    });
  }

  /** Repasses da academia (o dono acompanha o dinheiro). */
  static async listPayouts(user, id_academy) {
    return runWithLogs(log, "listPayouts", () => ({ id_user: user?.id_user, id_academy }), async () => {
      const owned = await this._ownedAcademy(user.id_user, id_academy);
      if (owned.error) return owned;
      const [items, summary] = await Promise.all([
        AcademyFeeStorage.listPayoutsForAcademy(pool, id_academy, 200),
        AcademyFeeStorage.summaryForAcademy(pool, id_academy),
      ]);
      return { payouts: items, summary };
    });
  }

  /* ─────────────────────────────── pagar ─────────────────────────────── */

  static async pay(user, id_member, external_id) {
    return runWithLogs(
      log,
      "pay",
      () => ({ id_user: user?.id_user, id_member, external_id }),
      async () => {
        const member = await AcademyStorage.getMemberById(pool, id_member);
        if (!member || String(member.id_user) !== String(user.id_user)) {
          return { error: "Vínculo não encontrado.", statusCode: 404 };
        }
        const academy = await AcademyStorage.getById(pool, member.id_academy);
        if (!(await this.payEnabled(academy))) {
          return { error: "Esta academia ainda não recebe pela Freelandoo.", statusCode: 409 };
        }

        // Dois cliques / duas abas: devolve o checkout que já existe.
        const open = await AcademyFeeStorage.getOpenOrder(pool, academy.id_academy, external_id);
        if (open?.status === "paid") {
          return { error: "Esta mensalidade já foi paga.", statusCode: 409 };
        }
        if (open?.status === "pending" && open.checkout_url) {
          return { order: open, checkout_url: open.checkout_url, reused: true };
        }

        // ── a cobrança AGORA, na academia ──
        const token = tokenOf(academy);
        if (!token) return { error: "A academia está sem conexão. Pague na recepção.", statusCode: 503 };
        const res = await gymProvider.getPayment(academy.api_base_url, token, external_id);
        if (res.error) {
          return { error: "Não conseguimos falar com a academia agora. Tente de novo.", statusCode: 502 };
        }
        const charge = res.data || {};
        if (digits(charge.cpf) !== member.cpf) {
          // A API devolveu a cobrança de OUTRA pessoa para este id: nunca cobrar.
          log.warn("pay.cpf_mismatch", { id_member, external_id });
          return { error: "Cobrança não encontrada.", statusCode: 404 };
        }
        if (!PAYABLE.includes(charge.status)) {
          return { error: "Esta mensalidade não está mais em aberto.", statusCode: 409 };
        }
        const amount = Math.round(Number(charge.amount_cents) || 0);
        if (amount <= 0) return { error: "Valor da mensalidade inválido.", statusCode: 409 };

        const StoreGovernanceService = require("./StoreGovernanceService");
        const [settings, gov] = await Promise.all([
          AcademyFeeStorage.getSettings(pool),
          StoreGovernanceService.getSettings(),
        ]);
        const estimate = estimateProcessorFee(amount, gov?.settings);
        const money = splitFee({
          amountCents: amount,
          platformFeeCents: settings.platform_fee_cents,
          processorFeeCents: estimate.cents,
        });

        // (1) o pedido nasce ANTES da rede (mesma ordem do PaymentGateway).
        let order = await AcademyFeeStorage.createOrder(pool, {
          id_academy: academy.id_academy,
          id_member: member.id_member,
          id_user: user.id_user,
          external_id: String(external_id),
          due_date: charge.due_date || null,
          amount_cents: money.amount_cents,
          platform_fee_cents: money.platform_fee_cents,
          processor_fee_cents: money.processor_fee_cents,
          processor_fee_source: estimate.source,
          net_cents: money.net_cents,
        });
        if (!order) {
          // Perdeu a corrida para outro clique.
          const other = await AcademyFeeStorage.getOpenOrder(pool, academy.id_academy, external_id);
          if (other?.checkout_url) return { order: other, checkout_url: other.checkout_url, reused: true };
          return { error: "Pagamento já em andamento. Atualize a página.", statusCode: 409 };
        }

        try {
          const back = `${frontendUrl()}/esportes/academia`;
          const session = await PaymentGateway.createCheckout({
            amount_cents: money.amount_cents,
            currency: "BRL",
            productName: `Mensalidade — ${academy.nome}`,
            customerEmail: user.email || undefined,
            clientReferenceId: user.id_user,
            successUrl: `${back}?mensalidade=success&session_id={CHECKOUT_SESSION_ID}`,
            cancelUrl: `${back}?mensalidade=cancel`,
            metadata: {
              type: "academy_fee",
              user_id: user.id_user,
              id_academy: academy.id_academy,
              id_order: String(order.id_order),
            },
          });
          order = await AcademyFeeStorage.attachCharge(pool, order.id_order, {
            provider: providerOf(session),
            session_id: session.id,
            provider_ref: session.provider_ref || session.id,
            checkout_url: session.url || null,
          });
          return { order, checkout_url: session.url, session_id: session.id };
        } catch (err) {
          log.error("pay.charge.fail", { id_order: order.id_order, message: err?.message });
          // Libera a trava do índice único para o próximo clique.
          await AcademyFeeStorage.cancelById(pool, order.id_order);
          return { error: "Não foi possível iniciar o pagamento. Tente de novo.", statusCode: 502 };
        }
      }
    );
  }

  /* ────────────────────────────── webhook ────────────────────────────── */

  /**
   * O pagamento caiu. Idempotente por session id (reentrega → `{already}`).
   * Ordem: apura a tarifa → recalcula o líquido → escreve o repasse → espelho
   * → baixa na academia → avisa o dono.
   */
  static async confirmStripeSession(session) {
    const paymentIntentId =
      typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null;

    const row = await AcademyFeeStorage.markPaid(pool, session.id, paymentIntentId);
    if (!row) {
      const existing = await AcademyFeeStorage.getBySession(pool, session.id);
      if (existing && existing.status !== "pending") return { already: true };
      return { error: "Pedido de mensalidade não encontrado para esta sessão." };
    }

    let order = row;
    try {
      const fee = await PaymentGateway.getChargeFee(paymentIntentId || row.provider_ref);
      const cents = Number(fee?.fee_cents);
      if (fee?.fee_cents !== null && fee?.fee_cents !== undefined && Number.isFinite(cents)) {
        const settings = await AcademyFeeStorage.getSettings(pool);
        // A taxa cheia de novo (não a do pedido): na estimativa ela pode ter
        // encolhido para caber, e com a tarifa real talvez caiba inteira.
        const money = splitFee({
          amountCents: row.amount_cents,
          platformFeeCents: settings.platform_fee_cents,
          processorFeeCents: cents,
        });
        const updated = await AcademyFeeStorage.applyProcessorFee(pool, row.id_order, money);
        if (updated) order = updated;
      } else {
        // `null` ≠ zero: sem apuração, o repasse sai na estimativa.
        log.warn("academy_fee.processor_fee.unavailable", { id_order: row.id_order });
      }
    } catch (err) {
      log.warn("academy_fee.processor_fee.fail", { id_order: row.id_order, message: err?.message });
    }

    try {
      const settings = await AcademyFeeStorage.getSettings(pool);
      await AcademyFeeStorage.createPayout(pool, {
        id_order: order.id_order,
        id_academy: order.id_academy,
        charge_cents: Number(order.amount_cents) || 0,
        platform_fee_cents: Number(order.platform_fee_cents) || 0,
        processor_fee_cents: Number(order.processor_fee_cents) || 0,
        net_cents: Number(order.net_cents) || 0,
        available_at: new Date(Date.now() + settings.holdback_days * 86400000),
      });
    } catch (err) {
      log.error("academy_fee.payout.fail", { id_order: order.id_order, message: err?.message });
    }

    await AcademyFeeStorage.markMirrorPaid(pool, order.id_academy, order.external_id).catch((err) =>
      log.warn("academy_fee.mirror.fail", { id_order: order.id_order, message: err?.message })
    );
    await this._notifyAcademy(order).catch(() => {});
    this._notifyOwner(order).catch(() => {});
    push(order.id_user, { external_id: order.external_id, status: "paid" });
    return { order };
  }

  static async expireBySession(session_id) {
    const row = await AcademyFeeStorage.cancelBySession(pool, session_id);
    return !!row;
  }

  static async handleChargeRefunded(charge) {
    const ref =
      typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id || null;
    if (!ref) return { ignored: true };
    const order = await AcademyFeeStorage.getByProviderRef(pool, ref);
    if (!order) return { ignored: true };
    if (!isFullRefund(charge)) {
      log.warn("academy_fee.refund.partial_ignored", { id_order: order.id_order });
      return { handled: false, partial: true };
    }
    if (order.refunded_at) return { handled: true, duplicate: true };

    const payoutStatus = await AcademyFeeStorage.reverseForRefund(pool, order.id_order);
    // Antes do PIX: a cobrança volta a ficar em aberto na academia. Depois: o
    // dinheiro já foi para ela — reabrir faria o aluno pagar de novo uma
    // mensalidade que a academia recebeu; quem resolve é o admin ("devido").
    const reopen = payoutStatus !== "devido";
    const refunded = await AcademyFeeStorage.markRefunded(pool, order.id_order, { reopen });
    if (reopen) {
      await AcademyFeeStorage.markMirrorReopened(pool, order.id_academy, order.external_id).catch(() => {});
      if (refunded) await this._reopenAcademy(refunded).catch(() => {});
    }
    log.info("academy_fee.refunded", { id_order: order.id_order, payout: payoutStatus });
    push(order.id_user, { external_id: order.external_id, status: "refunded" });
    return { handled: true };
  }

  /* ──────────────────────── conversa com a academia ──────────────────── */

  static async _notifyAcademy(order) {
    const academy = await AcademyStorage.getById(pool, order.id_academy);
    const token = academy && tokenOf(academy);
    if (!token) {
      await AcademyFeeStorage.markNotifyFailed(pool, order.id_order, "sem token");
      return false;
    }
    const res = await gymProvider.markPaid(academy.api_base_url, token, order.external_id, {
      amount_cents: Number(order.amount_cents),
      paid_at: new Date(order.paid_at || Date.now()).toISOString(),
      ref: `freelandoo:${order.id_order}`,
    });
    if (res.status === 409) {
      // A cobrança já estava paga lá (o aluno pagou pelos dois caminhos).
      // Repetir não resolve: encerra as tentativas e deixa o motivo para o
      // admin estornar o aluno.
      log.error("academy_fee.notify.already_paid", { id_order: order.id_order });
      await AcademyFeeStorage.markNotified(pool, order.id_order, "já paga na academia — estornar o aluno");
      return false;
    }
    if (res.error) {
      log.warn("academy_fee.notify.fail", { id_order: order.id_order, error: res.error });
      await AcademyFeeStorage.markNotifyFailed(pool, order.id_order, res.error);
      return false;
    }
    await AcademyFeeStorage.markNotified(pool, order.id_order);
    return true;
  }

  static async _reopenAcademy(order) {
    if (!order.academy_notified_at) {
      // A academia nunca soube da baixa: não há o que desfazer lá.
      await AcademyFeeStorage.markReopened(pool, order.id_order);
      return true;
    }
    const academy = await AcademyStorage.getById(pool, order.id_academy);
    const token = academy && tokenOf(academy);
    if (!token) {
      await AcademyFeeStorage.markNotifyFailed(pool, order.id_order, "sem token");
      return false;
    }
    const res = await gymProvider.reopen(academy.api_base_url, token, order.external_id, {
      ref: `freelandoo:${order.id_order}`,
    });
    if (res.error) {
      await AcademyFeeStorage.markNotifyFailed(pool, order.id_order, res.error);
      return false;
    }
    await AcademyFeeStorage.markReopened(pool, order.id_order);
    return true;
  }

  static async _notifyOwner(order) {
    const academy = await AcademyStorage.getById(pool, order.id_academy);
    if (!academy?.id_owner_user) return null;
    const settings = await AcademyFeeStorage.getSettings(pool);
    const member = order.id_member ? await AcademyStorage.getMemberById(pool, order.id_member) : null;
    return NotificationService.notifyAcademyFee({
      recipient_user_id: academy.id_owner_user,
      actor_user_id: order.id_user,
      id_academy: academy.id_academy,
      academy_slug: academy.slug,
      id_order: order.id_order,
      member_name: member?.member_name || null,
      amount_cents: order.amount_cents,
      net_cents: order.net_cents,
      available_at: new Date(Date.now() + settings.holdback_days * 86400000).toISOString(),
    });
  }

  /* ─────────────────────────────── varredor ──────────────────────────── */

  static async sweep() {
    return runWithLogs(log, "sweep", () => ({}), async () => {
      const released = await AcademyFeeStorage.releaseDuePayouts(pool);
      const pending = await AcademyFeeStorage.listAcademyPending(pool);
      let notified = 0;
      for (const o of pending) {
        const ok = o.status === "paid" ? await this._notifyAcademy(o) : await this._reopenAcademy(o);
        if (ok) notified++;
      }
      return { released: released.length, academy_synced: notified, academy_pending: pending.length };
    });
  }

  /* ─────────────────────────────── admin ─────────────────────────────── */

  static async listAdmin(query = {}) {
    return runWithLogs(log, "listAdmin", () => ({ status: query?.status }), async () => {
      const status = ["aguardando", "aprovado", "pago", "revertido", "devido"].includes(query.status)
        ? query.status
        : null;
      const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 200);
      const offset = Math.max(Number(query.offset) || 0, 0);
      const rows = await AcademyFeeStorage.listPayoutsAdmin(pool, { status, limit, offset });
      // O admin precisa da chave INTEIRA para fazer o PIX — e só ele recebe.
      return {
        payouts: rows.map(({ pix_key_sealed, holder_doc_sealed, ...r }) => {
          let pix_key = null;
          let holder_doc = null;
          try {
            pix_key = pix_key_sealed ? secretBox.open(pix_key_sealed) : null;
            holder_doc = holder_doc_sealed ? secretBox.open(holder_doc_sealed) : null;
          } catch {
            /* selo ilegível: o admin vê sem chave e não paga às cegas */
          }
          return { ...r, pix_key, holder_doc };
        }),
      };
    });
  }

  static async markPaidOut(admin, id_payout, body) {
    return runWithLogs(log, "markPaidOut", () => ({ id_payout }), async () => {
      const row = await AcademyFeeStorage.markPayoutPaid(pool, id_payout, {
        note: body?.note,
        by: admin?.id_user,
      });
      if (!row) return { error: "Repasse não encontrado ou ainda não liberado.", statusCode: 409 };
      return { payout: row };
    });
  }
}

module.exports = AcademyFeeService;
