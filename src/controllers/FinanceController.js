const FinanceService = require("../services/FinanceService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class FinanceController {
  static async getPlatform(req, res) {
    const result = await FinanceService.getPlatform();
    return sendServiceResult(res, result);
  }

  static async ranking(req, res) {
    const result = await FinanceService.ranking(req.user?.id_user, req.query || {});
    return sendServiceResult(res, result);
  }
}

module.exports = FinanceController;
