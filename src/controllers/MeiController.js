const MeiService = require("../services/mei/MeiService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class MeiController {
  static async overview(req, res) {
    const result = await MeiService.overview(req.user, req.query || {});
    return sendServiceResult(res, result);
  }

  static async saveProfile(req, res) {
    const result = await MeiService.saveProfile(req.user, req.body || {});
    return sendServiceResult(res, result);
  }

  static async listReceipts(req, res) {
    const result = await MeiService.listReceipts(req.user, req.query || {});
    return sendServiceResult(res, result);
  }

  static async getReceipt(req, res) {
    const result = await MeiService.getReceipt(req.user, req.params.id);
    return sendServiceResult(res, result);
  }

  static async createReceipt(req, res) {
    const result = await MeiService.createReceipt(req.user, req.body || {});
    return sendServiceResult(res, result, 201);
  }
}

module.exports = MeiController;
