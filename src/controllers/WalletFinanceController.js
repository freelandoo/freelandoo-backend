const WalletFinanceService = require("../services/WalletFinanceService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class WalletFinanceController {
  static async getMonth(req, res) {
    return sendServiceResult(res, await WalletFinanceService.getMonth(req.user, req.query || {}));
  }
  static async createEntry(req, res) {
    return sendServiceResult(res, await WalletFinanceService.createEntry(req.user, req.body || {}));
  }
  static async updateEntry(req, res) {
    return sendServiceResult(res, await WalletFinanceService.updateEntry(req.user, req.params.id, req.body || {}));
  }
  static async deleteEntry(req, res) {
    return sendServiceResult(res, await WalletFinanceService.deleteEntry(req.user, req.params.id));
  }
  static async listCategories(req, res) {
    return sendServiceResult(res, await WalletFinanceService.listCategories(req.user, req.query || {}));
  }
  static async createCategory(req, res) {
    return sendServiceResult(res, await WalletFinanceService.createCategory(req.user, req.body || {}));
  }
}

module.exports = WalletFinanceController;
