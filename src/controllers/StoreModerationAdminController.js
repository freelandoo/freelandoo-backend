const StoreModerationAdminService = require("../services/StoreModerationAdminService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class StoreModerationAdminController {
  static async listRules(req, res) {
    const result = await StoreModerationAdminService.listRules(req.user, req.query);
    return sendServiceResult(res, result);
  }
  static async createRule(req, res) {
    const result = await StoreModerationAdminService.createRule(req.user, req.body);
    return sendServiceResult(res, result, 201);
  }
  static async updateRule(req, res) {
    const result = await StoreModerationAdminService.updateRule(req.user, req.params.id, req.body);
    return sendServiceResult(res, result);
  }
  static async removeRule(req, res) {
    const result = await StoreModerationAdminService.removeRule(req.user, req.params.id);
    return sendServiceResult(res, result);
  }
  static async ruleOccurrences(req, res) {
    const result = await StoreModerationAdminService.ruleOccurrences(req.user, req.params.id);
    return sendServiceResult(res, result);
  }
  static async listPendingProducts(req, res) {
    const result = await StoreModerationAdminService.listPendingProducts(req.user);
    return sendServiceResult(res, result);
  }
  static async reviewProduct(req, res) {
    const result = await StoreModerationAdminService.reviewProduct(req.user, req.params.id, req.body);
    return sendServiceResult(res, result);
  }
  static async reviewRequest(req, res) {
    const result = await StoreModerationAdminService.reviewRequest(req.user, req.params.id, req.body);
    return sendServiceResult(res, result);
  }
}

module.exports = StoreModerationAdminController;
