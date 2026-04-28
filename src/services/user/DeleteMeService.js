const StripeService = require("../StripeService");
const ProfileSubscriptionStorage = require("../../storages/ProfileSubscriptionStorage");
const { createLogger } = require("../../utils/logger");

const log = createLogger("DeleteMeService");

async function execute({ db, id_user }) {
  // Cancela todas as assinaturas ativas no Stripe antes de desativar a conta
  const subscriptions = await ProfileSubscriptionStorage.listByUser(db, id_user);
  for (const sub of subscriptions) {
    if (sub.status === "active" && sub.stripe_subscription_id && !sub.canceled_at) {
      try {
        await StripeService.cancelSubscription(sub.stripe_subscription_id);
        log.info("stripe.canceled", { stripe_subscription_id: sub.stripe_subscription_id });
      } catch (err) {
        log.warn("stripe.cancel_fail", { stripe_subscription_id: sub.stripe_subscription_id, message: err?.message });
      }
    }
  }

  await db.query(
    `UPDATE public.tb_user SET ativo = FALSE, updated_at = NOW() WHERE id_user = $1`,
    [id_user]
  );

  log.info("user.deactivated", { id_user });
  return { ok: true };
}

module.exports = { execute };
