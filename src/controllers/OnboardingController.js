const OnboardingService = require("../services/OnboardingService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class OnboardingController {
  static async submitBirthdate(req, res) {
    const result = await OnboardingService.submitBirthdate(req.user, req.body);
    return sendServiceResult(res, result, 200);
  }
}

module.exports = OnboardingController;
