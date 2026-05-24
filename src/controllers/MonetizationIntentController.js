const MonetizationIntentService = require("../services/MonetizationIntentService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class MonetizationIntentController {
  static async status(req, res) {
    return sendServiceResult(res, await MonetizationIntentService.getStatus(req.user));
  }

  static async choose(req, res) {
    return sendServiceResult(res, await MonetizationIntentService.choose(req.user, req.body));
  }

  static async dismiss(req, res) {
    return sendServiceResult(res, await MonetizationIntentService.dismiss(req.user, req.body));
  }
}

module.exports = MonetizationIntentController;
