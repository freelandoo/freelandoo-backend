const BookingPayoutService = require("../services/BookingPayoutService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class BookingPayoutController {
  static async listMine(req, res) {
    const result = await BookingPayoutService.listMine(req.user, req.query || {});
    return sendServiceResult(res, result);
  }

  static async listAdmin(req, res) {
    const result = await BookingPayoutService.listAdmin(req.query || {});
    return sendServiceResult(res, result);
  }

  static async markPaidOut(req, res) {
    const id_payout = Number(req.params.id_payout);
    if (!Number.isFinite(id_payout)) {
      return res.status(400).json({ error: "id_payout inválido" });
    }
    const note = req.body?.note != null ? String(req.body.note) : null;
    const result = await BookingPayoutService.markPaidOut(id_payout, note);
    return sendServiceResult(res, result);
  }
}

module.exports = BookingPayoutController;
