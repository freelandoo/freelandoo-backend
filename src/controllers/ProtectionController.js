const ProtectionFulfillmentService = require("../services/ProtectionFulfillmentService");
const DisputeService = require("../services/DisputeService");
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

  // ── Disputas (comprador/cliente) ───────────────────────────────────────────
  static async openDispute(req, res) {
    const result = await DisputeService.openDispute(req.user, req.body || {}, req.files || []);
    return sendServiceResult(res, result);
  }

  static async getDispute(req, res) {
    const result = await DisputeService.getForUser(req.user, req.params.id);
    return sendServiceResult(res, result);
  }

  static async addDisputeEvidence(req, res) {
    const result = await DisputeService.addEvidence(req.user, req.params.id, req.files || [], req.body?.note);
    return sendServiceResult(res, result);
  }

  // ── Disputas (admin) ───────────────────────────────────────────────────────
  static async adminListDisputes(req, res) {
    const result = await DisputeService.listAdmin(req.query || {});
    return sendServiceResult(res, result);
  }

  static async adminDisputeDetail(req, res) {
    const result = await DisputeService.getAdminDetail(req.params.id);
    return sendServiceResult(res, result);
  }

  static async adminResolveDispute(req, res) {
    const result = await DisputeService.resolveByAdmin(req.user, req.params.id, req.body || {});
    return sendServiceResult(res, result);
  }
}

module.exports = ProtectionController;
