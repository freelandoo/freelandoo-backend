const StripeSubscriptionService = require("../services/StripeSubscriptionService");
const StripeWebhookService = require("../services/StripeWebhookService");
const StripeService = require("../services/StripeService");
const { createLogger } = require("../utils/logger");

const log = createLogger("StripeController");

function handleError(res, err) {
  if (err instanceof StripeSubscriptionService.ServiceError) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  throw err;
}

class StripeController {
  static async createSubscriptionCheckout(req, res) {
    try {
      const result = await StripeSubscriptionService.createSessionForUser(
        req.user,
        req.body || {}
      );
      return res.status(201).json(result);
    } catch (err) {
      return handleError(res, err);
    }
  }

  static async getMySubscriptions(req, res) {
    try {
      const result = await StripeSubscriptionService.getMySubscriptions(
        req.user
      );
      return res.json(result);
    } catch (err) {
      return handleError(res, err);
    }
  }

  static async cancelSubscription(req, res) {
    try {
      const result = await StripeSubscriptionService.cancelSubscriptionForUser(
        req.user,
        req.body || {}
      );
      return res.json(result);
    } catch (err) {
      return handleError(res, err);
    }
  }

  /**
   * POST /webhooks/stripe
   * Espera req.body como Buffer (express.raw).
   */
  static async handleWebhook(req, res) {
    const signature = req.headers["stripe-signature"];
    let event;
    try {
      event = StripeService.constructWebhookEvent(req.body, signature);
    } catch (err) {
      log.warn("webhook.signature_invalid", { message: err?.message });
      return res.status(400).json({ error: `Webhook signature invalid` });
    }

    try {
      await StripeWebhookService.processEvent(event);
      return res.json({ received: true });
    } catch (err) {
      log.error("webhook.process_fail", {
        event_id: event?.id,
        type: event?.type,
        message: err?.message,
        stack: err?.stack,
      });
      return res.status(500).json({ error: "Falha ao processar evento" });
    }
  }
}

module.exports = StripeController;
