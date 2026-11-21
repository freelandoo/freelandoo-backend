// src/services/BankAccessService.js
//
// A ASSINATURA DOS BANCOS CONECTADOS (mig 462) — R$ 20/mês, até 2 bancos.
//
// ⚠️ CÓPIA DELIBERADA DO SELO VERIFICADO (VerificationService, mig 268), que já
// resolve o mesmo problema e já passou pelo webhook de verdade:
//
//   CARTÃO → assinatura (`recurring: true` = preapproval do Mercado Pago).
//            Cada fatura paga empurra `paid_until` um mês.
//   PIX    → compra UM mês (Pix recorrente não existe no Mercado Pago).
//
// Não entra pelos Planos (mig 225): lá só cabe UM plano vivo por pessoa, e quem
// assina o Plano Negócio também precisa poder assinar os bancos.
//
// ⚠️ QUEM TEM ACESSO NÃO É DECIDIDO AQUI: é `bankAccessSql` (pagou e está no
// período, ou é administrador). Vencer não precisa de job para TIRAR o acesso;
// o sweeper do BankConnectionService só pausa a sincronização (custo) e, depois
// da carência, desconecta.
//
// ⚠️ CANCELAR NÃO DESCONECTA NA HORA: o mês pago é de quem pagou.

const pool = require("../databases");
const BankAccessStorage = require("../storages/BankAccessStorage");
const PaymentGateway = require("../integrations/payments");
const { providerOf } = require("../integrations/payments/contract");
const { isFullRefund } = require("../utils/refunds");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("BankAccessService");

function frontendUrl() {
  return String(process.env.FRONTEND_URL || "https://freelandoo.com.br").replace(/\/$/, "");
}

/** Voltou a pagar: religa a sincronização que o sweeper tinha pausado. Best-effort. */
function resumeSync(id_user) {
  const BankConnectionService = require("./BankConnectionService");
  BankConnectionService.resumeUser(id_user).catch((err) =>
    log.warn("bank_access.resume_fail", { id_user, message: err.message })
  );
}

class BankAccessService {
  /** O que a tela precisa: estado, preço, limites e se está à venda. */
  static async getMine(user) {
    if (!user?.id_user) return { error: "Não autenticado", statusCode: 401 };
    const [status, settings] = await Promise.all([
      BankAccessStorage.getStatus(pool, user.id_user),
      BankAccessStorage.getSettings(pool),
    ]);
    if (!status) return { error: "Usuário não encontrado", statusCode: 404 };
    return {
      has_access: !!status.has_access,
      // O admin tem acesso pelo PAPEL, sem pagar — a tela diz isso em vez de
      // oferecer uma assinatura que não muda nada.
      by_admin: !!status.is_admin,
      max_banks: settings.max_banks,
      connects_per_month: settings.connects_per_month,
      paid_until: status.paid_until || null,
      renews: !!status.subscription_ref && status.subscription_status !== "canceled",
      subscription_status: status.subscription_status || null,
      monthly_cents: settings.monthly_cents,
      for_sale: settings.is_active && settings.monthly_cents > 0,
    };
  }

  /**
   * Abre o pagamento do acesso.
   *
   * ⚠️ DUAS ASSINATURAS NA MESMA CONTA COBRARIAM DUAS VEZES POR MÊS, e a
   * segunda ficaria invisível (`subscription_ref` guarda uma só) — uma
   * cobrança viva no gateway que ninguém aqui sabe cancelar.
   */
  static async createCheckout(user, body) {
    return runWithLogs(
      log,
      "createCheckout",
      () => ({ id_user: user?.id_user, method: body?.method }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado", statusCode: 401 };
        const method = body?.method === "pix" ? "pix" : "card";

        const settings = await BankAccessStorage.getSettings(pool);
        if (!settings.is_active || !settings.monthly_cents) {
          return { error: "Os bancos conectados não estão à venda agora.", statusCode: 400 };
        }

        const current = await BankAccessStorage.getByUser(pool, user.id_user);
        if (method === "card" && current?.subscription_ref && current.subscription_status === "active") {
          return {
            error: "Você já tem a assinatura dos bancos conectados ativa.",
            statusCode: 409,
            paid_until: current.paid_until,
          };
        }

        const back = `${frontendUrl()}/wallet/carteira`;
        const session = await PaymentGateway.createCheckout({
          amount_cents: settings.monthly_cents,
          currency: "BRL",
          recurring: method === "card",
          productName: "Bancos conectados — Freelandoo",
          description: "Conecte até 2 bancos na sua Carteira por 1 mês",
          // Obrigatório no preapproval do Mercado Pago.
          customerEmail: user.email || undefined,
          clientReferenceId: user.id_user,
          successUrl: `${back}?bancos=success&session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${back}?bancos=cancel`,
          metadata: {
            type: "bank_access",
            user_id: user.id_user,
            method,
          },
        });

        await BankAccessStorage.createPayment(pool, {
          id_user: user.id_user,
          method,
          payment_provider: providerOf(session),
          amount_cents: settings.monthly_cents,
          stripe_session_id: session.id,
        });

        // ⚠️ A ASSINATURA É GRAVADA NA CRIAÇÃO, não só na confirmação: a
        // renovação chega como fatura e é por `subscription_ref` que ela acha a
        // pessoa. Nasce 'past_due' porque autorizado ainda não é pago.
        if (method === "card" && session.subscription) {
          await BankAccessStorage.attachSubscription(pool, user.id_user, {
            ref: session.subscription,
            provider: providerOf(session),
            status: "past_due",
          });
        }

        return { checkout_url: session.url, session_id: session.id, method };
      }
    );
  }

  /**
   * Solta a renovação. O acesso fica até o fim do período pago.
   *
   * ⚠️ A PORTA DE SAÍDA NÃO DEPENDE DO GATEWAY RESPONDER: falhando o cancel
   * remoto, o vínculo local é solto mesmo assim e o erro vai para o log.
   */
  static async cancel(user) {
    return runWithLogs(
      log,
      "cancel",
      () => ({ id_user: user?.id_user }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado", statusCode: 401 };
        const current = await BankAccessStorage.getByUser(pool, user.id_user);
        if (!current?.subscription_ref) {
          return {
            error: "Você não tem renovação automática — o acesso fica até a data paga.",
            statusCode: 409,
            paid_until: current?.paid_until || null,
          };
        }
        try {
          await PaymentGateway.cancelSubscription(current.subscription_ref, { immediate: true });
        } catch (err) {
          log.warn("cancel.remote_fail", {
            id_user: user.id_user,
            subscription_ref: current.subscription_ref,
            error: err.message,
          });
        }
        const row = await BankAccessStorage.detachSubscription(pool, user.id_user);
        return {
          message: "Renovação cancelada. Os bancos ficam conectados até o fim do período pago.",
          paid_until: row?.paid_until || current.paid_until,
        };
      }
    );
  }

  /* ─────────────────────────────── webhook ─────────────────────────────── */

  /** Primeiro mês (cartão ou Pix). Idempotente por session id. */
  static async confirmStripeSession(session) {
    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id || null;

    const row = await BankAccessStorage.markPaymentPaid(pool, session.id, paymentIntentId);
    if (!row) {
      const existing = await BankAccessStorage.getPaymentBySession(pool, session.id);
      if (existing?.status === "paid") return { already: true };
      return { error: "Cobrança dos bancos conectados não encontrada para esta sessão." };
    }

    const before = await BankAccessStorage.getByUser(pool, row.id_user);
    const live = await BankAccessStorage.extendPaidUntil(pool, row.id_user, 1);
    await BankAccessStorage.setPaymentPeriod(pool, row.id_payment, {
      period_start:
        before?.paid_until && new Date(before.paid_until) > new Date() ? before.paid_until : new Date(),
      period_end: live?.paid_until || null,
    });
    if (before?.subscription_ref) {
      await BankAccessStorage.setSubscriptionStatus(pool, row.id_user, "active");
    }

    log.info("bank_access.paid", { id_user: row.id_user, paid_until: live?.paid_until });
    resumeSync(row.id_user);
    return { payment: row, paid_until: live?.paid_until || null };
  }

  static async expireBySession(session_id) {
    return BankAccessStorage.markPaymentCanceled(pool, session_id);
  }

  // ⚠️ CONTRATO DA CADEIA: `{ ignored: true }` quando a assinatura não é desta
  // feature — o webhook tenta um fluxo depois do outro.
  static async handleInvoicePaid(invoice, subscriptionId) {
    if (!subscriptionId) return { ignored: true };
    const current = await BankAccessStorage.getBySubscriptionRef(pool, subscriptionId);
    if (!current) return { ignored: true };

    // Sem id de fatura não dá para deduplicar: não credita. O lado seguro do
    // erro é o acesso vencer, não a plataforma dar meses de graça.
    const invoiceRef = invoice?.id || null;
    if (!invoiceRef) {
      log.warn("renewal.no_invoice_id", { id_user: current.id_user, subscriptionId });
      return { handled: false, reason: "invoice_sem_id" };
    }

    const pi =
      typeof invoice?.payment_intent === "string"
        ? invoice.payment_intent
        : invoice?.payment_intent?.id || (typeof invoice?.charge === "string" ? invoice.charge : null);

    const recorded = await BankAccessStorage.recordRenewalOnce(pool, {
      id_user: current.id_user,
      payment_provider: current.subscription_provider || providerOf(invoice),
      amount_cents: Number(invoice?.amount_paid ?? invoice?.amount_due ?? 0) || 0,
      invoice_ref: invoiceRef,
      payment_intent_id: pi,
    });
    if (!recorded) return { handled: true, duplicate: true };

    const live = await BankAccessStorage.extendPaidUntil(pool, current.id_user, 1);
    await BankAccessStorage.setPaymentPeriod(pool, recorded.id_payment, {
      period_start:
        current.paid_until && new Date(current.paid_until) > new Date() ? current.paid_until : new Date(),
      period_end: live?.paid_until || null,
    });
    await BankAccessStorage.setSubscriptionStatus(pool, current.id_user, "active");
    log.info("bank_access.renewed", { id_user: current.id_user, paid_until: live?.paid_until });
    resumeSync(current.id_user);
    return { handled: true };
  }

  /** Fatura falhou: o acesso NÃO sai agora — sai quando o período pago vencer. */
  static async handleInvoiceFailed(subscriptionId) {
    if (!subscriptionId) return { ignored: true };
    const current = await BankAccessStorage.getBySubscriptionRef(pool, subscriptionId);
    if (!current) return { ignored: true };
    await BankAccessStorage.setSubscriptionStatus(pool, current.id_user, "past_due");
    return { handled: true };
  }

  static async handleSubscriptionDeleted(subscription) {
    const ref = typeof subscription === "string" ? subscription : subscription?.id;
    if (!ref) return { ignored: true };
    const current = await BankAccessStorage.getBySubscriptionRef(pool, ref);
    if (!current) return { ignored: true };
    await BankAccessStorage.detachSubscription(pool, current.id_user);
    return { handled: true };
  }

  /** Estorno total: o mês que aquela cobrança comprou é devolvido. */
  static async handleChargeRefunded(charge) {
    const paymentIntentId =
      typeof charge?.payment_intent === "string" ? charge.payment_intent : charge?.payment_intent?.id || null;
    if (!paymentIntentId) return { ignored: true };
    const payment = await BankAccessStorage.getPaymentByPaymentIntent(pool, paymentIntentId);
    if (!payment) return { ignored: true };
    if (!isFullRefund(charge)) return { handled: false, partial: true };
    if (payment.refunded_at) return { handled: true, duplicate: true };

    await BankAccessStorage.markPaymentRefunded(pool, payment.id_payment);
    await BankAccessStorage.shrinkPaidUntil(pool, payment.id_user, 1);
    log.info("bank_access.refunded", { id_user: payment.id_user, id_payment: payment.id_payment });
    return { handled: true };
  }

  /* ─────────────────────────────── admin ─────────────────────────────── */

  static async getSettings() {
    return { settings: await BankAccessStorage.getSettings(pool) };
  }

  static async updateSettings(user, body) {
    const b = body || {};
    const monthly =
      b.monthly_cents === undefined
        ? null
        : Math.min(100000, Math.max(0, Math.round(Number(b.monthly_cents) || 0)));
    const settings = await BankAccessStorage.updateSettings(pool, {
      monthly_cents: monthly,
      is_active: b.is_active === undefined ? null : b.is_active !== false,
      max_banks: b.max_banks === undefined ? null : Math.min(10, Math.max(1, Math.round(Number(b.max_banks) || 2))),
      connects_per_month:
        b.connects_per_month === undefined ? null : Math.min(20, Math.max(1, Math.round(Number(b.connects_per_month) || 3))),
      updated_by: user?.id_user || null,
    });
    return { settings };
  }
}

module.exports = BankAccessService;
