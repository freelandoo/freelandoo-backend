const StoreGovernanceService = require("../services/StoreGovernanceService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class StoreGovernanceController {
  static async get(req, res) {
    const result = await StoreGovernanceService.getSettings();
    return sendServiceResult(res, result);
  }

  static async update(req, res) {
    const result = await StoreGovernanceService.updateSettings(req.user, req.body);
    return sendServiceResult(res, result);
  }

  static async pricePreview(req, res) {
    const sellerCents = req.query?.seller_cents;
    const result = await StoreGovernanceService.pricePreview(sellerCents);
    return sendServiceResult(res, result);
  }
}

module.exports = StoreGovernanceController;
