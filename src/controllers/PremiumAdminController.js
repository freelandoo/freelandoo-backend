const PremiumService = require("../services/PremiumService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class PremiumAdminController {
  static async getSettings(req, res) {
    return sendServiceResult(res, await PremiumService.adminGetSettings());
  }

  static async updateSettings(req, res) {
    return sendServiceResult(res, await PremiumService.adminUpdateSettings(req.body || {}));
  }

  static async listCityOverrides(req, res) {
    return sendServiceResult(res, await PremiumService.adminListCityOverrides());
  }

  static async upsertCityOverride(req, res) {
    return sendServiceResult(res, await PremiumService.adminUpsertCityOverride(req.body || {}), 201);
  }

  static async deleteCityOverride(req, res) {
    return sendServiceResult(res, await PremiumService.adminDeleteCityOverride(req.params.id));
  }

  static async listActive(req, res) {
    return sendServiceResult(res, await PremiumService.adminListActive(req.query || {}));
  }
}

module.exports = PremiumAdminController;
