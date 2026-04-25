const BookingAvailabilityService = require("../services/BookingAvailabilityService");
const BookingService = require("../services/BookingService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class BookingController {
  // ─── Owner: regras semanais ──────────────────────────────────────
  static async getWeeklyRules(req, res) {
    const result = await BookingAvailabilityService.getWeeklyRules(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async saveWeeklyRules(req, res) {
    const result = await BookingAvailabilityService.saveWeeklyRules(req.user, req.params, req.body);
    return sendServiceResult(res, result);
  }

  // ─── Owner: exceções por data ────────────────────────────────────
  static async getOverrides(req, res) {
    const result = await BookingAvailabilityService.getOverrides(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async saveOverride(req, res) {
    const result = await BookingAvailabilityService.saveOverride(req.user, req.params, req.body);
    return sendServiceResult(res, result);
  }

  static async deleteOverride(req, res) {
    const result = await BookingAvailabilityService.deleteOverride(req.user, req.params);
    return sendServiceResult(res, result);
  }

  // ─── Owner: configurações de sinal ───────────────────────────────
  static async getBookingSettings(req, res) {
    const result = await BookingAvailabilityService.getBookingSettings(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async saveBookingSettings(req, res) {
    const result = await BookingAvailabilityService.saveBookingSettings(req.user, req.params, req.body);
    return sendServiceResult(res, result);
  }

  // ─── Owner: agendamentos ─────────────────────────────────────────
  static async listProfileBookings(req, res) {
    const result = await BookingService.listProfileBookings(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async listOwnerBookings(req, res) {
    const result = await BookingService.listOwnerBookings(req.user);
    return sendServiceResult(res, result);
  }

  static async updateBookingStatus(req, res) {
    const result = await BookingService.updateBookingStatus(req.user, req.params, req.body);
    return sendServiceResult(res, result);
  }

  // ─── Público: slots disponíveis ──────────────────────────────────
  static async getAvailableSlots(req, res) {
    const result = await BookingAvailabilityService.getAvailableSlots(
      req.params.id_profile,
      req.query.date
    );
    return sendServiceResult(res, result);
  }

  // ─── Público: criar booking ──────────────────────────────────────
  static async createPublicBooking(req, res) {
    const result = await BookingService.createPublicBooking(req.params.id_profile, req.body);
    return sendServiceResult(res, result, 201);
  }
}

module.exports = BookingController;
