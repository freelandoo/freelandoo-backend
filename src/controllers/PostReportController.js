const PostReportService = require("../services/PostReportService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class PostReportController {
  static async report(req, res) {
    const result = await PostReportService.report(req.user, req.params, req.body || {});
    return sendServiceResult(res, result);
  }

  static async adminBan(req, res) {
    const result = await PostReportService.adminBan(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async adminUnban(req, res) {
    const result = await PostReportService.adminUnban(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async adminList(req, res) {
    const result = await PostReportService.adminList(req.user, req.query || {});
    return sendServiceResult(res, result);
  }

  static async adminResolve(req, res) {
    const result = await PostReportService.adminResolve(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async adminPreview(req, res) {
    const result = await PostReportService.adminPreview(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async alertSummary(req, res) {
    const result = await PostReportService.alertSummary(req.user);
    return sendServiceResult(res, result);
  }
}

module.exports = PostReportController;
