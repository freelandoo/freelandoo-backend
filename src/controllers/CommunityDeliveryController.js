// src/controllers/CommunityDeliveryController.js
// Camada fina do delivery entre vizinhos. Todo guard (morador, flag, dono da
// corrida, freio de cancelamento) mora no service.

const CommunityDeliveryService = require("../services/CommunityDeliveryService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class CommunityDeliveryController {
  static async board(req, res) {
    const result = await CommunityDeliveryService.board(req.user, req.params, req.query || {});
    return sendServiceResult(res, result);
  }

  static async open(req, res) {
    const result = await CommunityDeliveryService.open(req.user, req.params, req.body || {});
    return sendServiceResult(res, result, 201);
  }

  static async accept(req, res) {
    const result = await CommunityDeliveryService.accept(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async markDelivered(req, res) {
    const result = await CommunityDeliveryService.markDelivered(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async confirm(req, res) {
    const result = await CommunityDeliveryService.confirm(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async release(req, res) {
    const result = await CommunityDeliveryService.releaseByCourier(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async cancel(req, res) {
    const result = await CommunityDeliveryService.cancelByRequester(req.user, req.params);
    return sendServiceResult(res, result);
  }

  // ── mig 266: oferta e contraproposta ───────────────────────────────────────
  static async raiseOffer(req, res) {
    const result = await CommunityDeliveryService.raiseOffer(req.user, req.params, req.body || {});
    return sendServiceResult(res, result);
  }

  static async propose(req, res) {
    const result = await CommunityDeliveryService.propose(req.user, req.params, req.body || {});
    return sendServiceResult(res, result, 201);
  }

  static async withdrawProposal(req, res) {
    const result = await CommunityDeliveryService.withdrawProposal(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async acceptProposal(req, res) {
    const result = await CommunityDeliveryService.acceptProposal(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async setAvailability(req, res) {
    const result = await CommunityDeliveryService.setAvailability(
      req.user,
      req.params,
      req.body || {}
    );
    return sendServiceResult(res, result);
  }

  static async myPayouts(req, res) {
    const result = await CommunityDeliveryService.myPayouts(req.user, req.query || {});
    return sendServiceResult(res, result);
  }
}

module.exports = CommunityDeliveryController;
