const BookingReminderService = require("../services/BookingReminderService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class BookingReminderController {
  // Público (via link do e-mail) — sem autenticação.
  static async getConfirmInfo(req, res) {
    const result = await BookingReminderService.getConfirmInfo(req.params.token);
    return sendServiceResult(res, result);
  }

  static async submitConfirm(req, res) {
    const result = await BookingReminderService.submitConfirm(req.params.token, (req.body || {}).action);
    return sendServiceResult(res, result);
  }
}

module.exports = BookingReminderController;
