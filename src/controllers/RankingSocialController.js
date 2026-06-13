// src/controllers/RankingSocialController.js
const RankingSocialService = require("../services/RankingSocialService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class RankingSocialController {
  static async summary(req, res) {
    return sendServiceResult(res, await RankingSocialService.summary(req.user, req.query || {}));
  }

  static async getInteraction(req, res) {
    return sendServiceResult(
      res,
      await RankingSocialService.getInteraction(req.user, req.params || {}, req.query || {}),
    );
  }

  static async toggleProfileLike(req, res) {
    return sendServiceResult(
      res,
      await RankingSocialService.toggleProfileLike(req.user, req.params || {}),
    );
  }

  static async createComment(req, res) {
    return sendServiceResult(
      res,
      await RankingSocialService.createComment(req.user, req.params || {}, req.body || {}),
      201,
    );
  }

  static async toggleCommentLike(req, res) {
    return sendServiceResult(
      res,
      await RankingSocialService.toggleCommentLike(req.user, req.params || {}),
    );
  }

  static async deleteComment(req, res) {
    return sendServiceResult(
      res,
      await RankingSocialService.deleteComment(req.user, req.params || {}),
    );
  }
}

module.exports = RankingSocialController;
