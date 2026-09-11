const pool = require("../databases");
const PaymentOpsStorage = require("../storages/PaymentOpsStorage");
const PaymentIntentStorage = require("../storages/PaymentIntentStorage");
const StripeService = require("./StripeService");
const StripeWebhookService = require("./StripeWebhookService");
const asaas = require("../integrations/payments/asaasClient");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("PaymentReconciliationService");

/**
 * Estados do Asaas em que o dinheiro já é do vendedor.
 *
 * ⚠️ `CONFIRMED` entra junto de `RECEIVED` pela mesma razão do webhook: o
 * cliente pagou, e num boleto o repasse pode levar dias. Reconciliar só em
 * RECEIVED deixaria de socorrer exatamente quem pagou e não recebeu.
 */
const ASAAS_PAID = new Set(["CONFIRMED", "RECEIVED", "RECEIVED_IN_CASH"]);

/**
 * Recupera uma pendente que nasceu no ASAAS.
 *
 * ⚠️ Sem isto a reconciliação ficaria cega para metade da plataforma: o
 * `session_id` de uma cobrança do Asaas é o UUID da nossa intenção, e pedir
 * esse id ao Stripe devolve "não encontrado". O radar continuaria acusando a
 * pendência e o socorro nunca chegaria.
 */
async function recoverAsaas(intent) {
  if (!intent.provider_ref) return null;
  const payment = await asaas.getPayment(intent.provider_ref);
  if (!ASAAS_PAID.has(String(payment && payment.status))) return null;

  // Mesma reidratação do webhook — uma só, senão as duas divergem.
  const AsaasWebhookService = require("./AsaasWebhookService");
  const session = AsaasWebhookService.buildSessionLike(intent, payment);
  await StripeWebhookService.fulfillCheckoutSession(session);
  await PaymentIntentStorage.setStatus(pool, intent.id_payment_intent, "paid");
  return session;
}

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
          // De quem é esta pendente? A intenção (mig 231) sabe. Não achar
          // significa Stripe: é toda cobrança anterior ao gateway.
          const intent = await PaymentIntentStorage.getById(pool, session_id).catch(() => null);

          if (intent && intent.provider === "asaas") {
            const rescued = await recoverAsaas(intent);
            if (!rescued) continue;
            recovered++;
            log.warn("reconcile.recovered", { session_id, flow, provider: "asaas" });
            continue;
          }

          const session = await StripeService.retrieveSession(session_id);
          const paid =
            session?.payment_status === "paid" ||
            session?.payment_status === "no_payment_required";
          if (!paid) continue;
          await StripeWebhookService.fulfillCheckoutSession(session);
          recovered++;
          log.warn("reconcile.recovered", { session_id, flow, provider: "stripe" });
        } catch (err) {
          log.error("reconcile.session_fail", { session_id, flow, message: err.message });
        }
      }

      return { checked, recovered };
    });
  }
}

module.exports = PaymentReconciliationService;
