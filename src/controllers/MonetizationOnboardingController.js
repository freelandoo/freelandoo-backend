const MonetizationOnboardingService = require("../services/MonetizationOnboardingService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class MonetizationOnboardingController {
  static async status(req, res) {
    const result = await MonetizationOnboardingService.getStatus(req.user);
    return sendServiceResult(res, result);
  }

  static async select(req, res) {
    const result = await MonetizationOnboardingService.selectPath(req.user, req.body);
    return sendServiceResult(res, result);
  }

  static async dismiss(req, res) {
    const result = await MonetizationOnboardingService.dismiss(req.user, req.body);
    return sendServiceResult(res, result);
  }
}

module.exports = MonetizationOnboardingController;
