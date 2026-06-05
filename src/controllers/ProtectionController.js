const ProtectionFulfillmentService = require("../services/ProtectionFulfillmentService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class ProtectionController {
  // ── Provas de fulfillment ────────────────────────────────────────────────
  static async shipmentProof(req, res) {
    const result = await ProtectionFulfillmentService.submitShipmentProof(
      req.user, req.params.id, req.file
    );
    return sendServiceResult(res, result);
  }

  static async bookingArrivalProof(req, res) {
    const result = await ProtectionFulfillmentService.submitBookingProof(
      req.user, req.params.id, "arrival", req.file
    );
    return sendServiceResult(res, result);
  }

  static async bookingCompletionProof(req, res) {
    const result = await ProtectionFulfillmentService.submitBookingProof(
      req.user, req.params.id, "completion", req.file
    );
    return sendServiceResult(res, result);
  }

  static async confirmBookingArrival(req, res) {
    const result = await ProtectionFulfillmentService.confirmBookingArrival(
      req.user, req.params.id
    );
    return sendServiceResult(res, result);
  }

  static async orderProtectionStatus(req, res) {
    const result = await ProtectionFulfillmentService.getStatus("product", req.params.id);
    return sendServiceResult(res, result);
  }

  static async bookingProtectionStatus(req, res) {
    const result = await ProtectionFulfillmentService.getStatus("booking", req.params.id);
    return sendServiceResult(res, result);
  }
}

module.exports = ProtectionController;
