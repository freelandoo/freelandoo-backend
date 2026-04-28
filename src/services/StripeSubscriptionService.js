const pool = require("../databases");
const StripeService = require("./StripeService");
const AnnualFeeSettingsStorage = require("../storages/AnnualFeeSettingsStorage");
const ProfileSubscriptionStorage = require("../storages/ProfileSubscriptionStorage");
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

async function resolvePromotionCode(conn, couponCode) {
  if (!couponCode) return { promotion_code_id: null, id_coupon: null };
  const { rows } = await conn.query(
    `SELECT id_coupon, stripe_promotion_code_id, is_active, expires_at
     FROM public.tb_coupon
     WHERE UPPER(code) = UPPER($1)
     LIMIT 1`,
    [couponCode]
  );
  const row = rows[0];
  if (!row) throw new ServiceError("Cupom inválido", 400);
  if (!row.is_active) throw new ServiceError("Cupom inativo", 400);
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    throw new ServiceError("Cupom expirado", 400);
  }
  if (!row.stripe_promotion_code_id) {
    throw new ServiceError("Cupom não sincronizado com Stripe", 400);
  }
  return {
    promotion_code_id: row.stripe_promotion_code_id,
    id_coupon: row.id_coupon,
  };
}

/**
 * POST /stripe/subscription/checkout
 * body: { id_profile (required), coupon_code? }
 * Cada perfil tem assinatura independente.
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
      if (!settings || !settings.stripe_price_id) {
        throw new ServiceError(
          "Anuidade ainda não configurada — rode stripe-bootstrap",
          500
        );
      }
      if (!settings.is_active) {
        throw new ServiceError("Cobrança de anuidade está desativada", 409);
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
        throw new ServiceError("Este perfil já possui anuidade ativa", 409);
      }

      const couponInfo = await resolvePromotionCode(
        pool,
        body?.coupon_code || null
      );

      const frontend = String(process.env.FRONTEND_URL || "").replace(/\/$/, "");
      const successUrl = `${frontend}/pagamento/sucesso?session_id={CHECKOUT_SESSION_ID}&profile_id=${id_profile}`;
      const cancelUrl = `${frontend}/pagamento/cancelado?profile_id=${id_profile}`;

      const metadata = {
        id_user: String(user.id_user),
        id_profile: String(id_profile),
      };
      if (couponInfo.id_coupon) metadata.id_coupon = String(couponInfo.id_coupon);

      const session = await StripeService.createSubscriptionCheckoutSession({
        priceId: settings.stripe_price_id,
        customerEmail: dbUser.email,
        clientReferenceId: String(user.id_user),
        successUrl,
        cancelUrl,
        promotionCode: couponInfo.promotion_code_id,
        metadata,
      });

      await ProfileSubscriptionStorage.create(pool, {
        id_user: user.id_user,
        id_profile,
        status: "pending",
        amount_cents: settings.amount_cents,
        currency: settings.currency,
        stripe_customer_id:
          typeof session.customer === "string"
            ? session.customer
            : session.customer?.id || null,
        stripe_checkout_session_id: session.id,
        stripe_price_id: settings.stripe_price_id,
        stripe_promotion_code: couponInfo.promotion_code_id,
        id_coupon: couponInfo.id_coupon,
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
 * POST /stripe/subscription/cancel
 * Agenda cancelamento ao fim do período vigente (cancel_at_period_end).
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
      if (!sub) throw new ServiceError("Assinatura não encontrada", 404);
      if (sub.status !== "active") throw new ServiceError("Apenas assinaturas ativas podem ser canceladas", 409);
      if (!sub.stripe_subscription_id) throw new ServiceError("Assinatura sem ID Stripe", 400);
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

module.exports = {
  ServiceError,
  createSessionForUser,
  getMySubscriptions,
  cancelSubscriptionForUser,
};
