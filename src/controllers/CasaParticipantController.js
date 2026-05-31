const CasaParticipantService = require("../services/CasaParticipantService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class CasaParticipantController {
  // Público
  static async listPublic(req, res) {
    return sendServiceResult(res, await CasaParticipantService.listPublic());
  }

  static async getPublicBySlug(req, res) {
    return sendServiceResult(res, await CasaParticipantService.getPublicBySlug(req.params.slug));
  }

  // Conveniência Views (compra)
  static async createProductCheckout(req, res) {
    return sendServiceResult(res, await CasaParticipantService.createProductCheckout(req.user, req.body || {}));
  }

  static async listMyOrders(req, res) {
    return sendServiceResult(res, await CasaParticipantService.listMyOrders(req.user, req.query || {}));
  }
}

module.exports = CasaParticipantController;
