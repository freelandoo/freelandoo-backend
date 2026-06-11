const CasaParticipantService = require("../services/CasaParticipantService");
const CasaAudienceInteractionService = require("../services/CasaAudienceInteractionService");
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

  static async audienceSummary(req, res) {
    return sendServiceResult(res, await CasaAudienceInteractionService.summary(req.user, req.query || {}));
  }

  static async getAudienceInteraction(req, res) {
    return sendServiceResult(
      res,
      await CasaAudienceInteractionService.getInteraction(req.user, req.params || {}, req.query || {}),
    );
  }

  static async toggleAudienceLike(req, res) {
    return sendServiceResult(
      res,
      await CasaAudienceInteractionService.toggleTargetLike(req.user, req.params || {}, req.body || {}),
    );
  }

  static async createAudienceComment(req, res) {
    return sendServiceResult(
      res,
      await CasaAudienceInteractionService.createComment(req.user, req.params || {}, req.body || {}),
      201,
    );
  }

  static async toggleAudienceCommentLike(req, res) {
    return sendServiceResult(
      res,
      await CasaAudienceInteractionService.toggleCommentLike(req.user, req.params || {}),
    );
  }

  static async deleteAudienceComment(req, res) {
    return sendServiceResult(
      res,
      await CasaAudienceInteractionService.deleteComment(req.user, req.params || {}),
    );
  }
}

module.exports = CasaParticipantController;
