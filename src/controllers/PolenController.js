const PolenService = require("../services/PolenService");
const EmeraldService = require("../services/EmeraldService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class PolenController {
  static async wallet(req, res) {
    return sendServiceResult(res, await PolenService.getWallet(req.user));
  }

  static async history(req, res) {
    return sendServiceResult(res, await PolenService.history(req.user, req.query || {}));
  }

  static async requestRewardedAd(req, res) {
    return sendServiceResult(res, await PolenService.requestRewardedAd(req.user, req));
  }

  static async completeRewardedAd(req, res) {
    return sendServiceResult(res, await PolenService.completeRewardedAd(req.user, req.body || {}));
  }

  static async spend(req, res) {
    return sendServiceResult(res, await PolenService.spend(req.user, req.body || {}));
  }

  // A7 — Verde Esmeralda.
  static async emeraldHistory(req, res) {
    return sendServiceResult(res, await EmeraldService.history(req.user, req.query || {}));
  }

  static async convert(req, res) {
    return sendServiceResult(res, await EmeraldService.convert(req.user, req.body || {}));
  }

  static async adminEmeraldSettings(req, res) {
    return sendServiceResult(res, await EmeraldService.getAdminSettings());
  }

  static async updateAdminEmeraldSettings(req, res) {
    return sendServiceResult(res, await EmeraldService.updateAdminSettings(req.user, req.body || {}));
  }

  static async adminSettings(req, res) {
    return sendServiceResult(res, await PolenService.getAdminSettings());
  }

  static async updateAdminSettings(req, res) {
    return sendServiceResult(res, await PolenService.updateAdminSettings(req.user, req.body || {}));
  }

  static async adminMetrics(req, res) {
    return sendServiceResult(res, await PolenService.metrics());
  }
}

module.exports = PolenController;
