const ClanService = require("../services/ClanService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class ClanController {
  static async create(req, res) {
    const result = await ClanService.create(req.user, req.body);
    return sendServiceResult(res, result, 201);
  }

  static async getById(req, res) {
    const result = await ClanService.getById(req.params);
    return sendServiceResult(res, result);
  }

  static async getPublic(req, res) {
    const result = await ClanService.getPublic(req.params);
    return sendServiceResult(res, result);
  }

  static async listPublic(req, res) {
    const result = await ClanService.listPublic(req.query);
    return sendServiceResult(res, result);
  }

  static async listMine(req, res) {
    const result = await ClanService.listMine(req.user);
    return sendServiceResult(res, result);
  }

  static async getCreationEligibility(req, res) {
    const result = await ClanService.getCreationEligibility(req.user);
    return sendServiceResult(res, result);
  }

  static async invite(req, res) {
    const result = await ClanService.invite(req.user, req.params, req.body);
    return sendServiceResult(res, result, 201);
  }

  static async listInvitesByClan(req, res) {
    const result = await ClanService.listInvitesByClan(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async listMyInvites(req, res) {
    const result = await ClanService.listMyInvites(req.user);
    return sendServiceResult(res, result);
  }

  static async respondInvite(req, res) {
    const result = await ClanService.respondInvite(req.user, req.params, req.body);
    return sendServiceResult(res, result);
  }

  static async cancelInvite(req, res) {
    const result = await ClanService.cancelInvite(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async removeMember(req, res) {
    const result = await ClanService.removeMember(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async findInvitableProfiles(req, res) {
    const result = await ClanService.findInvitableProfiles(req.user, req.query);
    return sendServiceResult(res, result);
  }

  static async postMessage(req, res) {
    const result = await ClanService.postMessage(req.user, req.params, req.body);
    return sendServiceResult(res, result, 201);
  }

  static async listMessages(req, res) {
    const result = await ClanService.listMessages(req.user, req.params, req.query);
    return sendServiceResult(res, result);
  }

  static async deleteMessage(req, res) {
    const result = await ClanService.deleteMessage(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async createSlotCheckout(req, res) {
    const result = await ClanService.createSlotCheckout(req.user, req.params);
    return sendServiceResult(res, result, 201);
  }

  static async listSlotPurchases(req, res) {
    const result = await ClanService.listSlotPurchases(req.user, req.params);
    return sendServiceResult(res, result);
  }
}

module.exports = ClanController;
