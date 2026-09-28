// src/services/VerificationService.js
//
// O SELO VERIFICADO (mig 268) — R$9,90 por mês.
//
// A mecânica é a da mensalidade da vitrine (mig 252), copiada de propósito:
//
//   CARTÃO → assinatura de verdade (`recurring: true` = preapproval). Renova
//            sozinha; cada fatura paga empurra `paid_until` em um mês.
//   PIX    → compra UM MÊS. Recorrência em Pix não existe no Mercado Pago, e
//            por isso aqui não há assinatura nenhuma.
//
// ⚠️ QUEM ESTÁ VERIFICADO NÃO É DECIDIDO AQUI. É `utils/verifiedBadge`, lido no
// SELECT: pagou e está no período, ou é administrador. Este service só mexe na
// data — vencer não precisa de job.
//
// ⚠️ CANCELAR NÃO TIRA O SELO NA HORA: o mês pago é de quem pagou. Cancelar
// solta a renovação; quem tira o selo é a data vencendo.

const pool = require("../databases");
const VerificationStorage = require("../storages/VerificationStorage");
const PaymentGateway = require("../integrations/payments");
const { providerOf } = require("../integrations/payments/contract");
const { isFullRefund } = require("../utils/refunds");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("VerificationService");

function frontendUrl() {
  return String(process.env.FRONTEND_URL || "https://freelandoo.com.br").replace(/\/$/, "");
}

class VerificationService {
  /** O que a tela do selo precisa: estado, preço e se ainda está à venda. */
  static async getMine(user) {
    if (!user?.id_user) return { error: "Não autenticado", statusCode: 401 };
    const [status, settings] = await Promise.all([
      VerificationStorage.getStatus(pool, user.id_user),
      VerificationStorage.getSettings(pool),
    ]);
    if (!status) return { error: "Usuário não encontrado", statusCode: 404 };
    return {
      is_verified: !!status.is_verified,
      // O admin tem o selo pelo PAPEL, sem pagar — a tela diz isso em vez de
      // oferecer uma assinatura que não muda nada.
      by_admin: !!status.is_admin,
      paid_until: status.paid_until || null,
      renews: !!status.subscription_ref && status.subscription_status !== "canceled",
      subscription_status: status.subscription_status || null,
      monthly_cents: settings.monthly_cents,
      for_sale: settings.is_active && settings.monthly_cents > 0,
    };
  }

  /**
   * Abre o pagamento do selo.
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

        const settings = await VerificationStorage.getSettings(pool);
        if (!settings.is_active || !settings.monthly_cents) {
          return { error: "O selo verificado não está à venda agora.", statusCode: 400 };
        }

        const current = await VerificationStorage.getByUser(pool, user.id_user);
        if (method === "card" && current?.subscription_ref && current.subscription_status === "active") {
          return {
            error: "Você já tem a assinatura do selo ativa.",
            statusCode: 409,
            paid_until: current.paid_until,
          };
        }

        const back = `${frontendUrl()}/verificado`;
        const session = await PaymentGateway.createCheckout({
          amount_cents: settings.monthly_cents,
          currency: "BRL",
          recurring: method === "card",
          productName: "Selo verificado Freelandoo",
          description: "Selo verificado no seu perfil por 1 mês",
          // Obrigatório no preapproval do Mercado Pago.
          customerEmail: user.email || undefined,
          clientReferenceId: user.id_user,
          successUrl: `${back}?selo=success&session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${back}?selo=cancel`,
          metadata: {
            type: "verified_badge",
            user_id: user.id_user,
            method,
          },
        });

        await VerificationStorage.createPayment(pool, {
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
          await VerificationStorage.attachSubscription(pool, user.id_user, {
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
   * Solta a renovação. O selo fica até o fim do período pago.
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
        const current = await VerificationStorage.getByUser(pool, user.id_user);
        if (!current?.subscription_ref) {
          return {
            error: "Você não tem renovação automática — o selo fica até a data paga.",
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
        const row = await VerificationStorage.detachSubscription(pool, user.id_user);
        return {
          message: "Renovação cancelada. O selo fica até o fim do período pago.",
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

    const row = await VerificationStorage.markPaymentPaid(pool, session.id, paymentIntentId);
    if (!row) {
      const existing = await VerificationStorage.getPaymentBySession(pool, session.id);
      if (existing?.status === "paid") return { already: true };
      return { error: "Cobrança do selo não encontrada para esta sessão." };
    }

    const before = await VerificationStorage.getByUser(pool, row.id_user);
    const live = await VerificationStorage.extendPaidUntil(pool, row.id_user, 1);
    await VerificationStorage.setPaymentPeriod(pool, row.id_payment, {
      period_start:
        before?.paid_until && new Date(before.paid_until) > new Date() ? before.paid_until : new Date(),
      period_end: live?.paid_until || null,
    });
    if (before?.subscription_ref) {
      await VerificationStorage.setSubscriptionStatus(pool, row.id_user, "active");
    }

    log.info("verified.paid", { id_user: row.id_user, paid_until: live?.paid_until });
    return { payment: row, paid_until: live?.paid_until || null };
  }

  static async expireBySession(session_id) {
    return VerificationStorage.markPaymentCanceled(pool, session_id);
  }

  // ⚠️ CONTRATO DA CADEIA: `{ ignored: true }` quando a assinatura não é desta
  // feature — o webhook tenta um fluxo depois do outro.
  static async handleInvoicePaid(invoice, subscriptionId) {
    if (!subscriptionId) return { ignored: true };
    const current = await VerificationStorage.getBySubscriptionRef(pool, subscriptionId);
    if (!current) return { ignored: true };

    // Sem id de fatura não dá para deduplicar: não credita. O lado seguro do
    // erro é o selo vencer, não a plataforma dar meses de graça.
    const invoiceRef = invoice?.id || null;
    if (!invoiceRef) {
      log.warn("renewal.no_invoice_id", { id_user: current.id_user, subscriptionId });
      return { handled: false, reason: "invoice_sem_id" };
    }

    const pi =
      typeof invoice?.payment_intent === "string"
        ? invoice.payment_intent
        : invoice?.payment_intent?.id || (typeof invoice?.charge === "string" ? invoice.charge : null);

    const recorded = await VerificationStorage.recordRenewalOnce(pool, {
      id_user: current.id_user,
      payment_provider: current.subscription_provider || providerOf(invoice),
      amount_cents: Number(invoice?.amount_paid ?? invoice?.amount_due ?? 0) || 0,
      invoice_ref: invoiceRef,
      payment_intent_id: pi,
    });
    if (!recorded) return { handled: true, duplicate: true };

    const live = await VerificationStorage.extendPaidUntil(pool, current.id_user, 1);
    await VerificationStorage.setPaymentPeriod(pool, recorded.id_payment, {
      period_start:
        current.paid_until && new Date(current.paid_until) > new Date() ? current.paid_until : new Date(),
      period_end: live?.paid_until || null,
    });
    await VerificationStorage.setSubscriptionStatus(pool, current.id_user, "active");
    log.info("verified.renewed", { id_user: current.id_user, paid_until: live?.paid_until });
    return { handled: true };
  }

  /** Fatura falhou: o selo NÃO sai agora — sai quando o período pago vencer. */
  static async handleInvoiceFailed(subscriptionId) {
    if (!subscriptionId) return { ignored: true };
    const current = await VerificationStorage.getBySubscriptionRef(pool, subscriptionId);
    if (!current) return { ignored: true };
    await VerificationStorage.setSubscriptionStatus(pool, current.id_user, "past_due");
    return { handled: true };
  }

  static async handleSubscriptionDeleted(subscription) {
    const ref = typeof subscription === "string" ? subscription : subscription?.id;
    if (!ref) return { ignored: true };
    const current = await VerificationStorage.getBySubscriptionRef(pool, ref);
    if (!current) return { ignored: true };
    await VerificationStorage.detachSubscription(pool, current.id_user);
    return { handled: true };
  }

  /** Estorno total: o mês que aquela cobrança comprou é devolvido. */
  static async handleChargeRefunded(charge) {
    const paymentIntentId =
      typeof charge?.payment_intent === "string" ? charge.payment_intent : charge?.payment_intent?.id || null;
    if (!paymentIntentId) return { ignored: true };
    const payment = await VerificationStorage.getPaymentByPaymentIntent(pool, paymentIntentId);
    if (!payment) return { ignored: true };
    if (!isFullRefund(charge)) return { handled: false, partial: true };
    if (payment.refunded_at) return { handled: true, duplicate: true };

    await VerificationStorage.markPaymentRefunded(pool, payment.id_payment);
    await VerificationStorage.shrinkPaidUntil(pool, payment.id_user, 1);
    log.info("verified.refunded", { id_user: payment.id_user, id_payment: payment.id_payment });
    return { handled: true };
  }

  /* ─────────────────────────────── admin ─────────────────────────────── */

  static async getSettings() {
    return { settings: await VerificationStorage.getSettings(pool) };
  }

  static async updateSettings(user, body) {
    const b = body || {};
    const monthly =
      b.monthly_cents === undefined
        ? null
        : Math.min(100000, Math.max(0, Math.round(Number(b.monthly_cents) || 0)));
    const settings = await VerificationStorage.updateSettings(pool, {
      monthly_cents: monthly,
      is_active: b.is_active === undefined ? null : b.is_active !== false,
      updated_by: user?.id_user || null,
    });
    return { settings };
  }
}

module.exports = VerificationService;
