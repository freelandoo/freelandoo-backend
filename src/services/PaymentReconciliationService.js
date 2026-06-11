const pool = require("../databases");
const PaymentOpsStorage = require("../storages/PaymentOpsStorage");
const StripeService = require("./StripeService");
const StripeWebhookService = require("./StripeWebhookService");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("PaymentReconciliationService");

/**
 * Rede de segurança para webhooks perdidos (projeto PayDebug, D6).
 *
 * Se o evento checkout.session.completed nunca chega (queda do servidor,
 * webhook fora do ar, falha que esgotou os retries do Stripe), o comprador
 * pagou mas o pedido fica "pendente" para sempre. Este job varre os pendentes
 * antigos, consulta o estado REAL da session na API do Stripe e, se ela já foi
 * paga, re-dispara a entrega. fulfillCheckoutSession é idempotente por
 * session id, então re-entregar o que já foi entregue é um no-op seguro.
 */
class PaymentReconciliationService {
  static async run({ olderThanMinutes = 30, youngerThanDays = 3, limit = 100 } = {}) {
    return runWithLogs(log, "run", () => ({ olderThanMinutes, youngerThanDays, limit }), async () => {
      const candidates = await PaymentOpsStorage.listStaleSessions(pool, {
        olderThanMinutes,
        youngerThanDays,
        limit,
      });
      if (candidates.length === 0) return { checked: 0, recovered: 0 };

      // Dedup por session id (um mesmo pagamento pode ter linha em mais de um lugar).
      const seen = new Set();
      let recovered = 0;
      let checked = 0;

      for (const { session_id, flow } of candidates) {
        if (seen.has(session_id)) continue;
        seen.add(session_id);
        checked++;
        try {
          const session = await StripeService.retrieveSession(session_id);
          const paid =
            session?.payment_status === "paid" ||
            session?.payment_status === "no_payment_required";
          if (!paid) continue;
          await StripeWebhookService.fulfillCheckoutSession(session);
          recovered++;
          log.warn("reconcile.recovered", { session_id, flow });
        } catch (err) {
          log.error("reconcile.session_fail", { session_id, flow, message: err.message });
        }
      }

      return { checked, recovered };
    });
  }
}

module.exports = PaymentReconciliationService;
