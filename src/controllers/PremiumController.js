const PremiumService = require("../services/PremiumService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class PremiumController {
  static async quote(req, res) {
    return sendServiceResult(res, await PremiumService.getQuoteForProfile(req.params.profileId));
  }

  static async checkoutPolens(req, res) {
    return sendServiceResult(
      res,
      await PremiumService.checkoutWithPolens(req.user, req.params.profileId)
    );
  }

  static async checkoutStripe(req, res) {
    return sendServiceResult(
      res,
      await PremiumService.createStripeCheckout(req.user, req.params.profileId, req.body || {})
    );
  }
}

module.exports = PremiumController;
