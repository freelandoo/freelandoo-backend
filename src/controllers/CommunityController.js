const CommunityService = require("../services/CommunityService");
const CommunitySlotService = require("../services/CommunitySlotService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class CommunityController {
  static async createSlotCheckout(req, res) {
    const result = await CommunitySlotService.createCheckout(req.user);
    return sendServiceResult(res, result, 201);
  }

  static async create(req, res) {
    const result = await CommunityService.create(req.user, req.body);
    return sendServiceResult(res, result, 201);
  }

  static async getById(req, res) {
    const result = await CommunityService.getById(req.params);
    return sendServiceResult(res, result);
  }

  static async listPublic(req, res) {
    const result = await CommunityService.listPublic(req.query);
    return sendServiceResult(res, result);
  }

  static async getMembers(req, res) {
    const result = await CommunityService.getMembers(req.params);
    return sendServiceResult(res, result);
  }

  static async getCreationEligibility(req, res) {
    const result = await CommunityService.getCreationEligibility(req.user);
    return sendServiceResult(res, result);
  }

  static async updateTheme(req, res) {
    const result = await CommunityService.updateTheme(
      req.user,
      req.params,
      req.body || {}
    );
    return sendServiceResult(res, result);
  }

  static async join(req, res) {
    const result = await CommunityService.join(req.user, req.params);
    return sendServiceResult(res, result, 201);
  }

  static async leave(req, res) {
    const result = await CommunityService.leave(req.user, req.params);
    return sendServiceResult(res, result);
  }
}

module.exports = CommunityController;
