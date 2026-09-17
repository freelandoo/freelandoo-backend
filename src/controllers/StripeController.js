const StripeSubscriptionService = require("../services/StripeSubscriptionService");
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

  static async refundSubscription(req, res) {
    try {
      const result = await StripeSubscriptionService.refundSubscriptionForUser(
        req.user,
        req.body || {}
      );
      return res.json(result);
    } catch (err) {
      return handleError(res, err);
    }
  }

}

module.exports = StripeController;
