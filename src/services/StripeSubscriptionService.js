const pool = require("../databases");
const StripeService = require("./StripeService");
const CouponDiscountResolver = require("./CouponDiscountResolver");
const AnnualFeeSettingsStorage = require("../storages/AnnualFeeSettingsStorage");
const ProfileSubscriptionStorage = require("../storages/ProfileSubscriptionStorage");
const ProfileStorage = require("../storages/ProfileStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("StripeSubscriptionService");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class ServiceError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

async function loadUser(conn, id_user) {
  const { rows } = await conn.query(
    `SELECT id_user, nome, email FROM public.tb_user WHERE id_user = $1 LIMIT 1`,
    [id_user]
  );
  return rows[0] || null;
}

async function loadProfileForUser(conn, { id_profile, id_user }) {
  const { rows } = await conn.query(
    `SELECT id_profile, id_user, display_name, is_active
     FROM public.tb_profile
     WHERE id_profile = $1
     LIMIT 1`,
    [id_profile]
  );
  const row = rows[0];
  if (!row) throw new ServiceError("Perfil não encontrado", 404);
  if (String(row.id_user) !== String(id_user)) {
    throw new ServiceError("Perfil não pertence ao usuário", 403);
  }
  if (!row.is_active) {
    throw new ServiceError("Perfil está desativado", 409);
  }
  return row;
}

/**
 * Resolve e valida o cupom informado no checkout de ativação.
 *
 * Diferente da versão antiga (que devolvia o promotion_code do Stripe), aqui
 * devolvemos o cupom inteiro — o desconto é calculado por CouponDiscountResolver
 * e cobrado direto no preço ad-hoc. Promotion code do Stripe não reflete
 * override/regra-geral do admin, então não é mais usado.
 */
async function resolveCoupon(conn, couponCode, buyerUserId) {
  if (!couponCode) return { coupon: null };
  const { rows } = await conn.query(
    `SELECT id_coupon, code, owner_user_id, is_active, expires_at,
            discount_type, value, max_discount_cents
     FROM public.tb_coupon
     WHERE UPPER(code) = UPPER($1)
     LIMIT 1`,
    [couponCode]
  );
  const row = rows[0];
  if (!row) throw new ServiceError("Cupom inválido", 400);
  // Veto auto-afiliação: ninguém compra com o próprio cupom.
  if (row.owner_user_id && String(row.owner_user_id) === String(buyerUserId)) {
    throw new ServiceError("Você não pode usar seu próprio cupom", 400);
  }
  if (!row.is_active) throw new ServiceError("Cupom inativo", 400);
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    throw new ServiceError("Cupom expirado", 400);
  }
  return { coupon: row };
}

/**
 * POST /stripe/subscription/checkout
 * body: { id_profile (required), coupon_code? }
 *
 * Modelo: ATIVAÇÃO ÚNICA do perfil (R$ 300 vitalício, sem renovação).
 * Cria checkout em mode=payment. A subscription Stripe não é mais criada;
 * stripe_subscription_id fica NULL e stripe_payment_intent_id é preenchido
 * no webhook checkout.session.completed.
 */
async function createSessionForUser(user, body) {
  return runWithLogs(
    log,
    "createSessionForUser",
    () => ({
      id_user: user.id_user,
      id_profile: body?.id_profile,
      hasCoupon: !!(body && body.coupon_code),
    }),
    async () => {
      const id_profile = body?.id_profile;
      if (!id_profile || !UUID_RE.test(String(id_profile))) {
        throw new ServiceError("id_profile é obrigatório", 400);
      }

      const settings = await AnnualFeeSettingsStorage.get(pool);
      if (!settings || !settings.amount_cents) {
        throw new ServiceError(
          "Taxa de ativação ainda não configurada",
          500
        );
      }
      if (!settings.is_active) {
        throw new ServiceError("Cobrança de ativação está desativada", 409);
      }

      const dbUser = await loadUser(pool, user.id_user);
      if (!dbUser) throw new ServiceError("Usuário não encontrado", 404);

      const profile = await loadProfileForUser(pool, {
        id_profile,
        id_user: user.id_user,
      });

      const existing = await ProfileSubscriptionStorage.findActiveByProfile(
        pool,
        id_profile
      );
      if (existing && existing.status === "active") {
        throw new ServiceError("Este perfil já está ativado", 409);
      }

      const { coupon } = await resolveCoupon(
        pool,
        body?.coupon_code || null,
        user.id_user
      );

      // Desconto calculado pelas regras do admin (override > regra geral >
      // campos do cupom) e cobrado direto no preço — o promotion code do
      // Stripe ficava desatualizado quando o admin mudava o desconto.
      const fullAmount = Number(settings.amount_cents);
      let discountCents = 0;
      if (coupon) {
        const rule = await CouponDiscountResolver.resolve(pool, coupon);
        discountCents = CouponDiscountResolver.calculateDiscount({
          order_value_cents: fullAmount,
          rule,
        });
      }
      discountCents = Math.min(Math.max(discountCents, 0), fullAmount);
      const chargeAmount = fullAmount - discountCents;
      if (coupon && chargeAmount <= 0) {
        throw new ServiceError(
          "Este cupom zera o valor da ativação. Contate o suporte.",
          409
        );
      }

      const frontend = String(process.env.FRONTEND_URL || "").replace(/\/$/, "");
      const successUrl = `${frontend}/pagamento/sucesso?session_id={CHECKOUT_SESSION_ID}&profile_id=${id_profile}`;
      const cancelUrl = `${frontend}/pagamento/cancelado?profile_id=${id_profile}`;

      const metadata = {
        id_user: String(user.id_user),
        id_profile: String(id_profile),
        type: "profile_activation",
      };
      if (coupon) {
        metadata.id_coupon = String(coupon.id_coupon);
        // Comissão de afiliado: o webhook reconstrói o bruto a partir destes.
        metadata.original_amount_cents = String(fullAmount);
        metadata.coupon_discount_cents = String(discountCents);
      }

      const session = await StripeService.createProfileActivationCheckoutSession({
        amount_cents: chargeAmount,
        currency: settings.currency || "BRL",
        productName: `Ativação do perfil — ${profile.display_name || "Freelandoo"}`,
        customerEmail: dbUser.email,
        clientReferenceId: String(user.id_user),
        successUrl,
        cancelUrl,
        metadata,
      });

      await ProfileSubscriptionStorage.create(pool, {
        id_user: user.id_user,
        id_profile,
        status: "pending",
        amount_cents: chargeAmount,
        currency: settings.currency,
        stripe_customer_id:
          typeof session.customer === "string"
            ? session.customer
            : session.customer?.id || null,
        stripe_checkout_session_id: session.id,
        stripe_price_id: null,
        stripe_promotion_code: null,
        id_coupon: coupon ? coupon.id_coupon : null,
      });

      return {
        url: session.url,
        session_id: session.id,
        id_profile,
        profile_name: profile.display_name,
      };
    }
  );
}

/**
 * GET /stripe/subscription/me
 * Lista assinaturas do usuário, agrupadas por perfil.
 */
async function getMySubscriptions(user) {
  const subscriptions = await ProfileSubscriptionStorage.listByUser(
    pool,
    user.id_user
  );
  return { subscriptions };
}

/**
 * POST /stripe/subscription/cancel  (LEGACY)
 * Cancela renovação automática de subscriptions Stripe legacy (cancel_at_period_end).
 * Para ativações one-time (novo modelo), retorna erro — não há o que cancelar.
 * body: { id_subscription }
 */
async function cancelSubscriptionForUser(user, body) {
  return runWithLogs(
    log,
    "cancelSubscriptionForUser",
    () => ({ id_user: user.id_user, id_subscription: body?.id_subscription }),
    async () => {
      const id_subscription = body?.id_subscription;
      if (!id_subscription) throw new ServiceError("id_subscription é obrigatório", 400);

      const { rows } = await pool.query(
        `SELECT * FROM public.tb_profile_subscription
         WHERE id_subscription = $1 AND id_user = $2 LIMIT 1`,
        [id_subscription, user.id_user]
      );
      const sub = rows[0];
      if (!sub) throw new ServiceError("Ativação não encontrada", 404);
      if (sub.status !== "active") throw new ServiceError("Apenas ativações vigentes podem ser canceladas", 409);
      if (!sub.stripe_subscription_id) {
        throw new ServiceError(
          "Ativação única não tem renovação para cancelar. Use a opção de reembolso (válida nos 7 dias após o pagamento).",
          409
        );
      }
      if (sub.canceled_at) throw new ServiceError("Cancelamento já agendado", 409);

      const stripeSub = await StripeService.cancelSubscription(sub.stripe_subscription_id);

      const cancelAt = stripeSub.cancel_at
        ? new Date(stripeSub.cancel_at * 1000)
        : sub.current_period_end;

      await ProfileSubscriptionStorage.updateBySubscriptionId(
        pool,
        sub.stripe_subscription_id,
        { canceled_at: cancelAt }
      );

      return { ok: true, cancel_at: cancelAt };
    }
  );
}

/**
 * POST /stripe/subscription/refund
 * Reembolsa integralmente uma ATIVAÇÃO dentro de 7 dias corridos do pagamento
 * (lei brasileira — direito de arrependimento).
 *
 * Funciona em dois caminhos:
 *   - Ativações one-time (novo modelo): refunda via stripe_charge_id ou
 *     resolve charge via Payment Intent.
 *   - Subscriptions legacy ainda recorrentes: refunda invoice e cancela
 *     a subscription Stripe.
 *
 * Status final: 'expired' (perfil perde a ativação).
 * body: { id_subscription }
 */
async function refundSubscriptionForUser(user, body) {
  return runWithLogs(
    log,
    "refundSubscriptionForUser",
    () => ({ id_user: user.id_user, id_subscription: body?.id_subscription }),
    async () => {
      const id_subscription = body?.id_subscription;
      if (!id_subscription) throw new ServiceError("id_subscription é obrigatório", 400);

      const { rows } = await pool.query(
        `SELECT * FROM public.tb_profile_subscription
         WHERE id_subscription = $1 AND id_user = $2 LIMIT 1`,
        [id_subscription, user.id_user]
      );
      const sub = rows[0];
      if (!sub) throw new ServiceError("Ativação não encontrada", 404);
      if (sub.status !== "active") {
        throw new ServiceError("Apenas ativações vigentes podem ser reembolsadas", 409);
      }
      if (sub.refunded_at) throw new ServiceError("Reembolso já processado", 409);
      if (!sub.paid_at) throw new ServiceError("Ativação ainda não foi paga", 409);

      // Janela legal de 7 dias corridos (direito de arrependimento)
      const diffMs = Date.now() - new Date(sub.paid_at).getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      if (diffDays > 7) {
        throw new ServiceError("O prazo de 7 dias corridos para reembolso expirou", 409);
      }

      // Resolve charge_id por um dos caminhos disponíveis.
      let chargeId = sub.stripe_charge_id || null;

      if (!chargeId && sub.stripe_payment_intent_id) {
        // Ativação one-time — pega charge via Payment Intent.
        try {
          const pi = await StripeService.retrievePaymentIntent(sub.stripe_payment_intent_id, {
            expand: ["latest_charge"],
          });
          chargeId = typeof pi.latest_charge === "object"
            ? pi.latest_charge?.id
            : pi.latest_charge || null;
        } catch (err) {
          log.warn("refund.pi_lookup_fail", { pi: sub.stripe_payment_intent_id, message: err.message });
        }
      }

      if (!chargeId && sub.stripe_subscription_id) {
        // Subscription legacy — caminho antigo via invoice.
        try {
          const stripeSub = await StripeService.retrieveSubscription(sub.stripe_subscription_id);
          const latestInvoiceId =
            typeof stripeSub.latest_invoice === "string"
              ? stripeSub.latest_invoice
              : stripeSub.latest_invoice?.id || null;
          if (latestInvoiceId) {
            const invoice = await StripeService.retrieveInvoice(latestInvoiceId);
            chargeId = typeof invoice.charge === "string"
              ? invoice.charge
              : invoice.charge?.id || null;
          }
        } catch (err) {
          log.warn("refund.invoice_lookup_fail", { sub: sub.stripe_subscription_id, message: err.message });
        }
      }

      if (!chargeId) {
        throw new ServiceError("Cobrança Stripe não encontrada para esta ativação", 500);
      }

      // Emite reembolso integral
      const refund = await StripeService.createRefund(chargeId);

      // Se ainda houver subscription legacy ativa, cancela no Stripe pra parar renovação.
      if (sub.stripe_subscription_id) {
        try {
          await StripeService.cancelSubscriptionImmediate(sub.stripe_subscription_id);
        } catch (err) {
          log.warn("refund.cancel_legacy_sub_fail", { sub: sub.stripe_subscription_id, message: err.message });
        }
      }

      // Atualiza DB localmente — status 'expired' significa perdeu a ativação.
      await pool.query(
        `UPDATE public.tb_profile_subscription
         SET status = 'expired',
             canceled_at = NOW(),
             refunded_at = NOW(),
             stripe_refund_id = $2,
             stripe_charge_id = $3,
             updated_at = NOW()
         WHERE id_subscription = $1`,
        [id_subscription, refund.id, chargeId]
      );

      // Reverte ativação do perfil imediatamente
      if (sub.id_profile) {
        const conn = await pool.connect();
        try {
          const { rows: statusRows } = await conn.query(
            `SELECT id_status, desc_status FROM public.tb_status
             WHERE desc_status IN ('fee_paid', 'taxa_pendente')`
          );
          const feePaidId = statusRows.find((r) => r.desc_status === "fee_paid")?.id_status;
          const taxaPendenteId = statusRows.find((r) => r.desc_status === "taxa_pendente")?.id_status;

          if (feePaidId) {
            await ProfileStorage.deleteProfileStatus(conn, {
              id_profile: sub.id_profile,
              id_status: feePaidId,
            });
          }
          if (taxaPendenteId) {
            await ProfileStorage.insertProfileStatus(conn, {
              id_profile: sub.id_profile,
              id_status: taxaPendenteId,
              created_by: user.id_user,
            });
          }
        } finally {
          conn.release();
        }
      }

      return { ok: true, refund_id: refund.id };
    }
  );
}

module.exports = {
  ServiceError,
  createSessionForUser,
  getMySubscriptions,
  cancelSubscriptionForUser,
  refundSubscriptionForUser,
};
