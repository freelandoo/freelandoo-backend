// src/services/CommunityMembershipService.js
// Mensalidade de comunidade PRIVADA: assinatura Stripe mensal por membro.
// Cada fatura paga (invoice.paid) credita o líder (holdback 8 dias, espelha
// tb_vaquinha_payout) menos a taxa da plataforma (community_settings).
//
// Fluxo: checkout (linha pending) → checkout.session.completed ativa a
// assinatura E adiciona o membro → invoice.paid registra o pagamento mensal
// (idempotente por invoice id) → customer.subscription.deleted remove o membro
// (se a comunidade ainda for privada). Tolerante à ordem dos eventos: se o
// invoice.paid chegar antes do completed, resolvemos a linha pela metadata da
// subscription (id_sub) e ativamos por ali mesmo.
const pool = require("../databases");
const CommunityStorage = require("../storages/CommunityStorage");
const StripeService = require("./StripeService");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("CommunityMembershipService");
const HOLDBACK_DAYS = 8;
const DAY_MS = 24 * 60 * 60 * 1000;

class CommunityMembershipService {
  // ─── Checkout (entrada paga em comunidade privada) ─────────────────────────
  static async createCheckout(user, params) {
    return runWithLogs(
      log,
      "createCheckout",
      () => ({ id_user: user?.id_user, id_profile: params?.id_profile }),
      async () => {
        const id_user = user?.id_user;
        if (!id_user) return { error: "Usuário não autenticado" };

        const community = await CommunityStorage.getById(pool, params.id_profile);
        if (!community) return { error: "Comunidade não encontrada", statusCode: 404 };
        if (community.privacy !== "private" || !Number(community.monthly_cents)) {
          return { error: "Esta comunidade não exige mensalidade.", statusCode: 400 };
        }

        const existing = await CommunityStorage.getMembership(pool, params.id_profile, id_user);
        if (existing) return { error: "Você já é membro desta comunidade.", statusCode: 409 };

        // Mesmos requisitos do join gratuito: subperfil + teto de participação.
        const sub = await CommunityStorage.getHighestSubprofile(pool, id_user);
        if (!sub.has_subprofile) {
          return { error: "Você precisa de pelo menos um subperfil para entrar." };
        }
        const ent = await CommunityStorage.getEntitlement(pool, id_user);
        const memberships = await CommunityStorage.countMemberships(pool, id_user);
        if (memberships >= ent.member_cap) {
          return {
            error: "Limite de participação atingido. Compre um ingresso para entrar em mais comunidades.",
            member_cap: ent.member_cap,
            memberships,
          };
        }

        const live = await CommunityStorage.getLiveMemberSub(pool, params.id_profile, id_user);
        if (live && live.status !== "pending") {
          return { error: "Você já tem uma assinatura desta comunidade.", statusCode: 409 };
        }

        const monthly_cents = Number(community.monthly_cents);
        // Reusa a linha pending (checkout abandonado) ou cria uma nova.
        const subRow =
          live ||
          (await CommunityStorage.createPendingMemberSub(pool, {
            id_community_profile: params.id_profile,
            id_user,
            monthly_cents,
          }));

        const frontend = String(process.env.FRONTEND_URL || "https://freelandoo.com").replace(/\/$/, "");
        const session = await StripeService.createMonthlySubscriptionCheckoutSession({
          amount_cents: monthly_cents,
          currency: "BRL",
          productName: `Mensalidade — ${community.display_name}`,
          customerEmail: user?.email || undefined,
          clientReferenceId: id_user,
          successUrl: `${frontend}/comunidades/${params.id_profile}?assinatura=sucesso&session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${frontend}/comunidades/${params.id_profile}?assinatura=cancelada`,
          metadata: {
            type: "community_membership",
            id_sub: String(subRow.id_sub),
            id_community_profile: String(params.id_profile),
            id_user: String(id_user),
          },
        });

        await CommunityStorage.setMemberSubSession(pool, subRow.id_sub, session.id);
        return { checkout_url: session.url, session_id: session.id };
      }
    );
  }

  // ─── Webhook: checkout.session.completed ────────────────────────────────────
  // Ativa a assinatura e adiciona o membro. Idempotente (status guard + addMember
  // com ON CONFLICT DO NOTHING).
  static async confirmStripeSession(session) {
    const meta = session?.metadata || {};
    if (meta.type !== "community_membership") return { ignored: true };

    const subscriptionId =
      typeof session.subscription === "string" ? session.subscription : session.subscription?.id || null;
    const customerId =
      typeof session.customer === "string" ? session.customer : session.customer?.id || null;

    let row = await CommunityStorage.getMemberSubBySession(pool, session.id);
    if (!row && meta.id_sub) row = await CommunityStorage.getMemberSubById(pool, meta.id_sub);
    if (!row) return { error: "Assinatura de comunidade não encontrada" };

    await CommunityStorage.activateMemberSub(pool, row.id_sub, {
      stripe_subscription_id: subscriptionId,
      stripe_customer_id: customerId,
    });
    await CommunityStorage.addMember(pool, row.id_community_profile, row.id_user, "member");
    log.info("membership.activated", { id_sub: row.id_sub, subscription: subscriptionId });
    return { ok: true, already: row.status === "active" };
  }

  // ─── Webhook: invoice.paid ──────────────────────────────────────────────────
  // Registra o pagamento mensal (idempotente por invoice id) e credita o líder.
  // Retorna { ignored: true } quando a subscription não é de comunidade.
  static async handleInvoicePaid(invoice, subscriptionId) {
    let row = await CommunityStorage.getMemberSubBySubscriptionId(pool, subscriptionId);
    if (!row) return { ignored: true };
    return this._recordInvoice(invoice, subscriptionId, row);
  }

  // Fallback pela metadata da subscription (invoice.paid antes do completed).
  static async handleInvoicePaidByMetadata(invoice, subscription) {
    const meta = subscription?.metadata || {};
    if (meta.type !== "community_membership" || !meta.id_sub) return { ignored: true };
    const row = await CommunityStorage.getMemberSubById(pool, meta.id_sub);
    if (!row) return { error: "Assinatura de comunidade não encontrada" };
    // Ativa por aqui mesmo (o completed pode ainda não ter chegado).
    await CommunityStorage.activateMemberSub(pool, row.id_sub, {
      stripe_subscription_id: subscription.id,
      stripe_customer_id:
        typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id || null,
    });
    await CommunityStorage.addMember(pool, row.id_community_profile, row.id_user, "member");
    return this._recordInvoice(invoice, subscription.id, row);
  }

  static async _recordInvoice(invoice, subscriptionId, row) {
    const gross = Number(invoice.amount_paid) || 0;
    if (gross <= 0) return { ok: true, zero: true };

    const community = await CommunityStorage.getById(pool, row.id_community_profile);
    if (!community) return { error: "Comunidade não encontrada" };

    const settings = await CommunityStorage.getSettings(pool);
    const feePercent = Number(settings.platform_fee_percent) || 0;
    const fee = Math.round((gross * feePercent) / 100);

    const paymentIntentId =
      typeof invoice.payment_intent === "string" ? invoice.payment_intent : invoice.payment_intent?.id || null;
    const chargeId = typeof invoice.charge === "string" ? invoice.charge : invoice.charge?.id || null;

    const inserted = await CommunityStorage.insertMemberPayment(pool, {
      id_sub: row.id_sub,
      id_community_profile: row.id_community_profile,
      id_owner_user: community.id_leader_user,
      gross_cents: gross,
      platform_fee_cents: fee,
      net_cents: Math.max(0, gross - fee),
      stripe_invoice_id: invoice.id,
      stripe_payment_intent_id: paymentIntentId,
      stripe_charge_id: chargeId,
      available_at: new Date(Date.now() + HOLDBACK_DAYS * DAY_MS),
    });
    if (!inserted) return { ok: true, already: true };

    // Renovação em dia → garante status active (pode vir de past_due).
    await CommunityStorage.markMemberSubStatusBySubscriptionId(pool, subscriptionId, "active");
    log.info("membership.invoice_paid", { id_sub: row.id_sub, invoice: invoice.id, gross });
    return { ok: true };
  }

  // ─── Webhook: invoice.payment_failed ────────────────────────────────────────
  static async handleInvoiceFailed(subscriptionId) {
    const row = await CommunityStorage.getMemberSubBySubscriptionId(pool, subscriptionId);
    if (!row) return { ignored: true };
    await CommunityStorage.markMemberSubStatusBySubscriptionId(pool, subscriptionId, "past_due");
    return { ok: true };
  }

  // ─── Webhook: customer.subscription.deleted ─────────────────────────────────
  // Assinatura morreu (cancelada pelo membro, inadimplência…). Remove o membro
  // SÓ se a assinatura ainda estava "viva" e a comunidade segue privada — quando
  // o líder torna a comunidade pública nós cancelamos as assinaturas localmente
  // primeiro, e aí os membros ficam (viraram membros gratuitos).
  static async handleSubscriptionDeleted(subscription) {
    const row = await CommunityStorage.getMemberSubBySubscriptionId(pool, subscription.id);
    if (!row) return { ignored: true };

    const wasLive = ["active", "past_due", "pending"].includes(row.status);
    await CommunityStorage.markMemberSubCanceled(pool, row.id_sub);
    if (!wasLive) return { ok: true, already: true };

    const community = await CommunityStorage.getById(pool, row.id_community_profile);
    if (community && community.privacy === "private") {
      const membership = await CommunityStorage.getMembership(pool, row.id_community_profile, row.id_user);
      if (membership && membership.role === "member") {
        await CommunityStorage.removeMember(pool, row.id_community_profile, row.id_user);
        log.info("membership.removed_on_cancel", { id_sub: row.id_sub, id_user: row.id_user });
      }
    }
    return { ok: true };
  }

  // ─── Webhook: charge.refunded ───────────────────────────────────────────────
  // Estorno de uma fatura mensal → reverte o crédito do líder.
  static async handleChargeRefunded(charge) {
    return runWithLogs(log, "handleChargeRefunded", () => ({ charge: charge?.id }), async () => {
      const paymentIntentId =
        typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id || null;
      const payment = await CommunityStorage.getMemberPaymentByCharge(pool, {
        chargeId: charge.id,
        paymentIntentId,
      });
      if (!payment) return null; // não é uma mensalidade nossa
      await CommunityStorage.revertMemberPayment(pool, payment.id_payment);
      return { reverted: true };
    });
  }

  // ─── Webhook: checkout.session.expired / async_payment_failed ──────────────
  static async expireBySession(sessionId) {
    return CommunityStorage.markMemberSubExpiredBySession(pool, sessionId);
  }

  // ─── Saída / cancelamento ───────────────────────────────────────────────────
  // Cancela a assinatura Stripe do membro (imediato). Usado pelo leave() e pela
  // troca privado→público (aí em modo period-end, sem tirar o membro).
  static async cancelForUser(id_community_profile, id_user) {
    const row = await CommunityStorage.getLiveMemberSub(pool, id_community_profile, id_user);
    if (!row) return { none: true };
    if (row.stripe_subscription_id) {
      try {
        await StripeService.cancelSubscriptionImmediate(row.stripe_subscription_id);
      } catch (err) {
        log.warn("cancelForUser.stripe_fail", { id_sub: row.id_sub, message: err.message });
      }
    }
    await CommunityStorage.markMemberSubCanceled(pool, row.id_sub);
    return { ok: true };
  }

  // Privado→público: para de cobrar todo mundo no fim do ciclo já pago, mas
  // mantém as memberships (comunidade virou gratuita).
  static async releaseAllSubscriptions(id_community_profile) {
    const rows = await CommunityStorage.listLiveMemberSubs(pool, id_community_profile);
    for (const row of rows) {
      if (row.stripe_subscription_id) {
        try {
          await StripeService.cancelSubscription(row.stripe_subscription_id); // period end
        } catch (err) {
          log.warn("releaseAll.stripe_fail", { id_sub: row.id_sub, message: err.message });
        }
      }
      await CommunityStorage.markMemberSubCanceled(pool, row.id_sub);
    }
    return { count: rows.length };
  }

  // ─── Resumo pro líder (painel da comunidade) ────────────────────────────────
  static async getSummary(user, params) {
    return runWithLogs(
      log,
      "getSummary",
      () => ({ id_user: user?.id_user, id_profile: params?.id_profile }),
      async () => {
        const id_user = user?.id_user;
        if (!id_user) return { error: "Usuário não autenticado" };
        const community = await CommunityStorage.getById(pool, params.id_profile);
        if (!community) return { error: "Comunidade não encontrada", statusCode: 404 };
        if (String(community.id_leader_user) !== String(id_user)) {
          return { error: "Apenas o líder pode ver as mensalidades.", statusCode: 403 };
        }
        const summary = await CommunityStorage.getMembershipSummary(pool, params.id_profile);
        return { summary };
      }
    );
  }
}

module.exports = CommunityMembershipService;
