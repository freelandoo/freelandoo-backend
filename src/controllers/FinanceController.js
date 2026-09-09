const FinanceService = require("../services/FinanceService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class FinanceController {
  static async getPlatform(req, res) {
    const result = await FinanceService.getPlatform();
    return sendServiceResult(res, result);
  }
}

module.exports = FinanceController;
