const BeeEngagementService = require("../services/BeeEngagementService");
const BeeFeedService = require("../services/BeeFeedService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class BeeController {
  static async timeline(req, res) {
    return sendServiceResult(res, await BeeFeedService.getTimeline(req.user, req.query));
  }
  static async getOne(req, res) {
    return sendServiceResult(res, await BeeFeedService.getOne(req.user, req.params));
  }
  static async listBookmarked(req, res) {
    return sendServiceResult(res, await BeeFeedService.listBookmarked(req.user));
  }
  static async toggleLike(req, res) {
    return sendServiceResult(res, await BeeEngagementService.toggleLike(req.user, req.params));
  }
  static async listComments(req, res) {
    return sendServiceResult(res, await BeeEngagementService.listComments(req.user, req.params, req.query));
  }
  static async createComment(req, res) {
    return sendServiceResult(res, await BeeEngagementService.createComment(req.user, req.params, req.body || {}), 201);
  }
  static async deleteComment(req, res) {
    return sendServiceResult(res, await BeeEngagementService.deleteComment(req.user, req.params));
  }
  static async toggleCommentLike(req, res) {
    return sendServiceResult(res, await BeeEngagementService.toggleCommentLike(req.user, req.params));
  }
  static async report(req, res) {
    return sendServiceResult(res, await BeeEngagementService.report(req.user, req.params, req.body || {}), 201);
  }
  static async toggleBookmark(req, res) {
    return sendServiceResult(res, await BeeEngagementService.toggleBookmark(req.user, req.params));
  }
  static async recordEvent(req, res) {
    return sendServiceResult(res, await BeeEngagementService.recordEvent(req.user, req.body || {}), 202);
  }
  static async adminListReported(req, res) {
    return sendServiceResult(res, await BeeEngagementService.adminListReported());
  }
  static async adminRemove(req, res) {
    return sendServiceResult(res, await BeeEngagementService.adminRemove(req.params));
  }
  static async adminResolve(req, res) {
    return sendServiceResult(res, await BeeEngagementService.adminResolve(req.params));
  }
}

module.exports = BeeController;
