const SellerBalanceService = require("../services/SellerBalanceService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class SellerBalanceController {
  static async listMine(req, res) {
    const result = await SellerBalanceService.listMine(req.user, req.query || {});
    return sendServiceResult(res, result);
  }

  static async listAdmin(req, res) {
    const result = await SellerBalanceService.listAdmin(req.query || {});
    return sendServiceResult(res, result);
  }

  static async markPaidOut(req, res) {
    const id_balance = Number(req.params.id_balance);
    if (!Number.isFinite(id_balance)) {
      return res.status(400).json({ error: "id_balance inválido" });
    }
    const note = req.body?.note != null ? String(req.body.note) : null;
    const result = await SellerBalanceService.markPaidOut(id_balance, note);
    return sendServiceResult(res, result);
  }
}

module.exports = SellerBalanceController;
