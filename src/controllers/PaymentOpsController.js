const pool = require("../databases");
const StripeWebhookEventStorage = require("../storages/StripeWebhookEventStorage");
const PaymentOpsStorage = require("../storages/PaymentOpsStorage");
const StripeWebhookService = require("../services/StripeWebhookService");
const PaymentReconciliationService = require("../services/PaymentReconciliationService");
const { checkHealth: checkShippingHealth } = require("../integrations/melhorenvio/health");
const { createLogger } = require("../utils/logger");

const log = createLogger("PaymentOpsController");

/**
 * Painel admin de saúde de pagamentos (projeto PayDebug).
 * Todas as rotas exigem Administrator (guard no arquivo de rotas).
 */
class PaymentOpsController {
  // GET /admin/payments/webhook-events?status=failed&limit=&offset=
  static async listWebhookEvents(req, res) {
    const status = req.query.status ? String(req.query.status) : null;
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const [events, counts] = await Promise.all([
      StripeWebhookEventStorage.listForAdmin(pool, { status, limit, offset }),
      StripeWebhookEventStorage.countByStatus(pool),
    ]);
    return res.json({ events, counts });
  }

  // POST /admin/payments/webhook-events/:event_id/reprocess
  static async reprocessWebhookEvent(req, res) {
    const event_id = String(req.params.event_id || "");
    if (!event_id) return res.status(400).json({ error: "event_id obrigatório" });
    const result = await StripeWebhookService.reprocessEvent(event_id);
    if (result.error) {
      const code = result.error === "event_not_found" ? 404 : 422;
      return res.status(code).json(result);
    }
    log.info("webhook.reprocessed", { event_id, by: req.user?.id_user });
    return res.json(result);
  }

  // GET /admin/payments/stuck?hours=24
  static async listStuck(req, res) {
    const olderThanHours = Math.min(Math.max(Number(req.query.hours) || 24, 1), 720);
    const flows = await PaymentOpsStorage.staleCounts(pool, { olderThanHours });
    const total = flows.reduce((s, f) => s + (f.count || 0), 0);
    return res.json({ older_than_hours: olderThanHours, total, flows });
  }

  // POST /admin/payments/reconcile  → varre pendentes e cruza com o Stripe
  static async reconcileNow(req, res) {
    const result = await PaymentReconciliationService.run({
      olderThanMinutes: Number(req.body?.older_than_minutes) || 30,
      youngerThanDays: Number(req.body?.younger_than_days) || 3,
      limit: Math.min(Math.max(Number(req.body?.limit) || 100, 1), 300),
    });
    log.info("reconcile.manual", { by: req.user?.id_user, ...result });
    return res.json(result);
  }

  // GET /admin/payments/shipping-health  → preflight do Melhor Envio
  // (ambiente, validade do token, conta autenticada e saldo da carteira).
  // Usar antes da 1ª compra real pra confirmar a virada sandbox→produção.
  static async shippingHealth(req, res) {
    const result = await checkShippingHealth();
    log.info("shipping.health", {
      by: req.user?.id_user,
      environment: result.environment,
      ok: result.ok,
      balance: result.balance,
    });
    return res.json(result);
  }
}

module.exports = PaymentOpsController;
