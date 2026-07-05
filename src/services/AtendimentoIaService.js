// src/services/AtendimentoIaService.js
// Venda do Atendimento IA: planos (preço + limite de tokens LLM/ciclo),
// assinatura Stripe mensal (1 viva por user) e ciclo de vida com o bot
// (provisionar/atualizar/desligar via AtendimentoIaProvisionService).
// Receita 100% da plataforma — sem payout/holdback.
const pool = require("../databases");
const AtendimentoIaStorage = require("../storages/AtendimentoIaStorage");
const AtendimentoIaProvisionService = require("./AtendimentoIaProvisionService");
const StripeService = require("./StripeService");
const { isFullRefund } = require("../utils/refunds");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("AtendimentoIaService");

const EXTRA_INSTRUCTIONS_MAX = 2000;

function publicPlan(p) {
  return {
    id_plan: Number(p.id_plan),
    name: p.name,
    description: p.description,
    monthly_cents: Number(p.monthly_cents),
    token_limit_monthly: Number(p.token_limit_monthly),
    sort_order: Number(p.sort_order),
  };
}

function publicSub(s) {
  if (!s) return null;
  return {
    id_sub: Number(s.id_sub),
    id_plan: Number(s.id_plan),
    monthly_cents: Number(s.monthly_cents),
    token_limit_monthly: Number(s.token_limit_monthly),
    status: s.status,
    provisioning_status: s.provisioning_status,
    current_period_end: s.current_period_end,
    config: s.config || {},
    activated_at: s.activated_at,
    created_at: s.created_at,
  };
}

function toTimestamp(epoch) {
  if (!epoch) return null;
  return new Date(Number(epoch) * 1000);
}

class AtendimentoIaService {
  // ─── Vendedor ──────────────────────────────────────────────────────────────
  static async getMine(user) {
    return runWithLogs(log, "getMine", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const plans = await AtendimentoIaStorage.listPlans(pool);
      const sub = await AtendimentoIaStorage.getLiveSubByUser(pool, user.id_user);
      let usage = null;
      if (sub && sub.status !== "pending" && sub.provisioning_status === "provisioned") {
        usage = await AtendimentoIaProvisionService.fetchUsage(user.id_user);
      }
      return { plans: plans.map(publicPlan), sub: publicSub(sub), usage };
    });
  }

  static async createCheckout(user, body = {}) {
    return runWithLogs(log, "createCheckout", () => ({ id_user: user?.id_user, id_plan: body?.id_plan }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };

      const plan = await AtendimentoIaStorage.getPlan(pool, Number(body.id_plan));
      if (!plan || !plan.is_active) return { error: "Plano não encontrado", statusCode: 404 };

      const live = await AtendimentoIaStorage.getLiveSubByUser(pool, user.id_user);
      if (live && live.status !== "pending") {
        return { error: "Você já tem uma assinatura ativa. Cancele-a para trocar de plano.", statusCode: 409 };
      }

      // Reusa a pending (checkout abandonado) SÓ se for do mesmo plano; senão
      // expira a antiga e cria outra com o snapshot certo.
      let sub = live;
      if (sub && Number(sub.id_plan) !== Number(plan.id_plan)) {
        await AtendimentoIaStorage.markSubCanceled(pool, sub.id_sub);
        sub = null;
      }
      if (!sub) {
        sub = await AtendimentoIaStorage.createPendingSub(pool, {
          id_user: user.id_user,
          id_plan: plan.id_plan,
          monthly_cents: Number(plan.monthly_cents),
          token_limit_monthly: Number(plan.token_limit_monthly),
        });
      }

      const frontend = String(process.env.FRONTEND_URL || "https://freelandoo.com").replace(/\/$/, "");
      const session = await StripeService.createMonthlySubscriptionCheckoutSession({
        amount_cents: Number(sub.monthly_cents),
        currency: "BRL",
        productName: `Atendimento IA — ${plan.name}`,
        customerEmail: user?.email || undefined,
        clientReferenceId: user.id_user,
        successUrl: `${frontend}/account/atendimento-ia?atendimento_ia=sucesso&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${frontend}/account/atendimento-ia?atendimento_ia=cancelado`,
        metadata: {
          type: "atendimento_ia",
          id_sub: String(sub.id_sub),
          id_user: String(user.id_user),
        },
      });

      await AtendimentoIaStorage.setSubSession(pool, sub.id_sub, session.id);
      return { checkout_url: session.url, session_id: session.id };
    });
  }

  static async updateConfig(user, body = {}) {
    return runWithLogs(log, "updateConfig", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const sub = await AtendimentoIaStorage.getLiveSubByUser(pool, user.id_user);
      if (!sub || sub.status === "pending") return { error: "Assinatura não encontrada", statusCode: 404 };

      const config = { ...(sub.config || {}) };
      if (body.paused !== undefined) config.paused = body.paused === true;
      if (body.answer_dm !== undefined) config.answer_dm = body.answer_dm !== false;
      if (body.answer_os !== undefined) config.answer_os = body.answer_os !== false;
      if (body.extra_instructions !== undefined) {
        config.extra_instructions = String(body.extra_instructions || "").slice(0, EXTRA_INSTRUCTIONS_MAX);
      }

      await AtendimentoIaStorage.setConfig(pool, sub.id_sub, config);
      // Best-effort: se o bot estiver fora, o sweeper re-provisiona depois.
      AtendimentoIaProvisionService.pushConfig(sub.id_sub).catch(() => {});
      return { ok: true, config };
    });
  }

  static async cancel(user) {
    return runWithLogs(log, "cancel", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const sub = await AtendimentoIaStorage.getLiveSubByUser(pool, user.id_user);
      if (!sub) return { error: "Assinatura não encontrada", statusCode: 404 };
      await this._teardown(sub, "user_cancel");
      return { ok: true };
    });
  }

  // Desliga tudo: Stripe (imediato), tokens gerenciados e o bot. Idempotente.
  static async _teardown(sub, reason) {
    if (sub.stripe_subscription_id) {
      try {
        await StripeService.cancelSubscriptionImmediate(sub.stripe_subscription_id);
      } catch (err) {
        log.warn("teardown.stripe_fail", { id_sub: sub.id_sub, message: err.message });
      }
    }
    await AtendimentoIaProvisionService.revokeConnections(sub);
    await AtendimentoIaStorage.markSubCanceled(pool, sub.id_sub);
    await AtendimentoIaProvisionService.pushDeprovision(sub).catch(() => {});
    log.info("teardown.done", { id_sub: sub.id_sub, reason });
  }

  // ─── Webhook Stripe ────────────────────────────────────────────────────────
  static async confirmStripeSession(session) {
    const meta = session?.metadata || {};
    if (meta.type !== "atendimento_ia") return { ignored: true };

    const subscriptionId =
      typeof session.subscription === "string" ? session.subscription : session.subscription?.id || null;
    const customerId =
      typeof session.customer === "string" ? session.customer : session.customer?.id || null;

    let sub = await AtendimentoIaStorage.getSubBySession(pool, session.id);
    if (!sub && meta.id_sub) sub = await AtendimentoIaStorage.getSubById(pool, meta.id_sub);
    if (!sub) return { error: "Assinatura do Atendimento IA não encontrada" };

    const already = sub.status === "active";
    await AtendimentoIaStorage.activateSub(pool, sub.id_sub, {
      stripe_subscription_id: subscriptionId,
      stripe_customer_id: customerId,
    });
    if (!already) {
      await AtendimentoIaProvisionService.scheduleProvision(sub.id_sub);
    }
    log.info("checkout.confirmed", { id_sub: sub.id_sub, already });
    return { ok: true, already };
  }

  static async handleInvoicePaid(invoice, subscriptionId) {
    const sub = await AtendimentoIaStorage.getSubBySubscriptionId(pool, subscriptionId);
    if (!sub) return { ignored: true };
    return this._applyInvoice(invoice, subscriptionId, sub);
  }

  // Fallback pela metadata da subscription (invoice.paid antes do completed).
  static async handleInvoicePaidByMetadata(invoice, subscription) {
    const meta = subscription?.metadata || {};
    if (meta.type !== "atendimento_ia" || !meta.id_sub) return { ignored: true };
    const sub = await AtendimentoIaStorage.getSubById(pool, meta.id_sub);
    if (!sub) return { error: "Assinatura do Atendimento IA não encontrada" };
    await AtendimentoIaStorage.activateSub(pool, sub.id_sub, {
      stripe_subscription_id: subscription.id,
      stripe_customer_id:
        typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id || null,
    });
    return this._applyInvoice(invoice, subscription.id, sub);
  }

  static async _applyInvoice(invoice, subscriptionId, sub) {
    // Período novo do ciclo — a âncora que zera o contador de tokens no bot.
    let periodStart = null;
    let periodEnd = null;
    try {
      const subscription = await StripeService.retrieveSubscription(subscriptionId);
      periodStart = toTimestamp(subscription?.current_period_start);
      periodEnd = toTimestamp(subscription?.current_period_end);
    } catch (err) {
      log.warn("invoice.sub_lookup_fail", { subscriptionId, message: err.message });
    }
    if (periodStart || periodEnd) {
      await AtendimentoIaStorage.setPeriod(pool, sub.id_sub, {
        period_start: periodStart,
        period_end: periodEnd,
      });
    }
    await AtendimentoIaStorage.setStatusBySubscriptionId(pool, subscriptionId, "active");

    // Renovação: re-push leve com o cycle_start novo (zera o contador no bot).
    // Primeira fatura: o provisionamento completo já foi agendado no completed
    // (ou será, pelo fallback de metadata) — o pushConfig cobre o ciclo mesmo assim.
    const fresh = await AtendimentoIaStorage.getSubById(pool, sub.id_sub);
    if (fresh?.provisioning_status === "provisioned") {
      AtendimentoIaProvisionService.pushConfig(sub.id_sub).catch(() => {});
    }
    log.info("invoice.applied", { id_sub: sub.id_sub, invoice: invoice.id });
    return { ok: true };
  }

  static async handleInvoiceFailed(subscriptionId) {
    const sub = await AtendimentoIaStorage.getSubBySubscriptionId(pool, subscriptionId);
    if (!sub) return { ignored: true };
    await AtendimentoIaStorage.setStatusBySubscriptionId(pool, subscriptionId, "past_due");
    return { ok: true };
  }

  static async handleSubscriptionDeleted(subscription) {
    const sub = await AtendimentoIaStorage.getSubBySubscriptionId(pool, subscription.id);
    if (!sub) return { ignored: true };
    if (sub.status === "canceled") return { ok: true, already: true };
    // Stripe cancelou (inadimplência/cancel externo) — não re-cancela no Stripe.
    await AtendimentoIaProvisionService.revokeConnections(sub);
    await AtendimentoIaStorage.markSubCanceled(pool, sub.id_sub);
    await AtendimentoIaProvisionService.pushDeprovision(sub).catch(() => {});
    return { ok: true };
  }

  // Estorno TOTAL de uma fatura do Atendimento IA → trata como cancelamento.
  // Parcial não desliga o serviço (tratamento manual, como nos outros fluxos).
  static async handleChargeRefunded(charge) {
    const invoiceId = typeof charge.invoice === "string" ? charge.invoice : charge.invoice?.id || null;
    if (!invoiceId) return { ignored: true };
    if (!isFullRefund(charge)) return { ignored: true };
    let subscriptionId = null;
    try {
      const invoice = await StripeService.retrieveInvoice(invoiceId);
      subscriptionId =
        typeof invoice?.subscription === "string" ? invoice.subscription : invoice?.subscription?.id || null;
    } catch {
      return { ignored: true };
    }
    if (!subscriptionId) return { ignored: true };
    const sub = await AtendimentoIaStorage.getSubBySubscriptionId(pool, subscriptionId);
    if (!sub) return { ignored: true };
    await this._teardown(sub, "charge_refunded");
    return { ok: true };
  }

  static async expireBySession(sessionId) {
    return AtendimentoIaStorage.markSubExpiredBySession(pool, sessionId);
  }

  // ─── Admin ─────────────────────────────────────────────────────────────────
  static async adminListPlans() {
    return runWithLogs(log, "adminListPlans", () => ({}), async () => {
      const plans = await AtendimentoIaStorage.listPlans(pool, { onlyActive: false });
      return { plans };
    });
  }

  static _validatePlanFields(body, { partial = false } = {}) {
    const fields = {};
    if (body.name !== undefined || !partial) {
      const name = String(body.name || "").trim();
      if (name.length < 2 || name.length > 60) return { error: "Nome do plano precisa ter entre 2 e 60 caracteres" };
      fields.name = name;
    }
    if (body.description !== undefined) fields.description = String(body.description || "").slice(0, 300) || null;
    if (body.monthly_cents !== undefined || !partial) {
      const m = Math.round(Number(body.monthly_cents));
      if (!Number.isFinite(m) || m <= 0) return { error: "Preço mensal inválido" };
      fields.monthly_cents = m;
    }
    if (body.token_limit_monthly !== undefined || !partial) {
      const t = Math.round(Number(body.token_limit_monthly));
      if (!Number.isFinite(t) || t <= 0) return { error: "Limite de tokens inválido" };
      fields.token_limit_monthly = t;
    }
    if (body.sort_order !== undefined) fields.sort_order = Math.round(Number(body.sort_order)) || 0;
    if (body.is_active !== undefined) fields.is_active = body.is_active !== false;
    return { fields };
  }

  static async adminCreatePlan(user, body = {}) {
    return runWithLogs(log, "adminCreatePlan", () => ({ id_user: user?.id_user }), async () => {
      const v = this._validatePlanFields(body);
      if (v.error) return { error: v.error, statusCode: 400 };
      const plan = await AtendimentoIaStorage.createPlan(pool, v.fields);
      return { plan };
    });
  }

  static async adminUpdatePlan(user, id_plan, body = {}) {
    return runWithLogs(log, "adminUpdatePlan", () => ({ id_user: user?.id_user, id_plan }), async () => {
      const v = this._validatePlanFields(body, { partial: true });
      if (v.error) return { error: v.error, statusCode: 400 };
      if (Object.keys(v.fields).length === 0) return { error: "Nada para atualizar", statusCode: 400 };
      const plan = await AtendimentoIaStorage.updatePlan(pool, Number(id_plan), v.fields);
      if (!plan) return { error: "Plano não encontrado", statusCode: 404 };
      return { plan };
    });
  }

  static async adminDeletePlan(user, id_plan) {
    return runWithLogs(log, "adminDeletePlan", () => ({ id_user: user?.id_user, id_plan }), async () => {
      // Soft delete: some da vitrine; assinaturas existentes seguem (snapshot).
      const plan = await AtendimentoIaStorage.updatePlan(pool, Number(id_plan), { is_active: false });
      if (!plan) return { error: "Plano não encontrado", statusCode: 404 };
      return { ok: true };
    });
  }

  static async adminListSubs(query = {}) {
    return runWithLogs(log, "adminListSubs", () => ({ status: query?.status }), async () => {
      const subs = await AtendimentoIaStorage.listSubsAdmin(pool, {
        status: query.status || null,
        limit: query.limit,
      });
      return {
        subs: subs.map((s) => ({
          id_sub: Number(s.id_sub),
          username: s.username,
          user_name: s.user_name,
          plan_name: s.plan_name,
          monthly_cents: Number(s.monthly_cents),
          token_limit_monthly: Number(s.token_limit_monthly),
          status: s.status,
          provisioning_status: s.provisioning_status,
          provision_attempts: Number(s.provision_attempts),
          provision_last_error: s.provision_last_error,
          current_period_end: s.current_period_end,
          created_at: s.created_at,
          activated_at: s.activated_at,
        })),
      };
    });
  }

  static async adminReprovision(user, id_sub) {
    return runWithLogs(log, "adminReprovision", () => ({ id_user: user?.id_user, id_sub }), async () => {
      const sub = await AtendimentoIaStorage.getSubById(pool, Number(id_sub));
      if (!sub) return { error: "Assinatura não encontrada", statusCode: 404 };
      if (!["active", "past_due"].includes(sub.status)) {
        return { error: "Assinatura não está ativa", statusCode: 400 };
      }
      const r = await AtendimentoIaProvisionService.pushProvision(sub.id_sub);
      if (r?.error) return { error: `Provisionamento falhou: ${r.error}`, statusCode: 502 };
      return { ok: true };
    });
  }
}

module.exports = AtendimentoIaService;
