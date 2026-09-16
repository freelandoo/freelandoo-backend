const SubscriptionEndService = require("../SubscriptionEndService");
const ProfileSubscriptionStorage = require("../../storages/ProfileSubscriptionStorage");
const { createLogger } = require("../../utils/logger");

const log = createLogger("DeleteMeService");

async function execute({ db, id_user }) {
  // Cancela todas as assinaturas ativas no Stripe antes de desativar a conta
  const subscriptions = await ProfileSubscriptionStorage.listByUser(db, id_user);
  for (const sub of subscriptions) {
    if (sub.status === "active" && sub.stripe_subscription_id && !sub.canceled_at) {
      try {
        // ⚠️ PELO SubscriptionEndService: apagar a conta não pode devolver
        // menos do que a pessoa comprou. Fora do Stripe a chamada crua cortaria
        // o mês pago na hora.
        await SubscriptionEndService.cancelAtPeriodEnd({
          subscriptionId: sub.stripe_subscription_id,
          id_user,
          reason: "conta apagada",
        });
        log.info("subscription.cancel_scheduled", {
          stripe_subscription_id: sub.stripe_subscription_id,
        });
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
