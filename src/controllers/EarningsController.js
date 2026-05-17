const EarningsService = require("../services/earnings/EarningsService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class EarningsController {
  static async listMine(req, res) {
    const result = await EarningsService.list(req.user, req.query || {});
    return sendServiceResult(res, result);
  }
}

module.exports = EarningsController;
