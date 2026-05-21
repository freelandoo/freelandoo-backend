const ServiceRequestService = require("../services/ServiceRequestService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class ServiceRequestController {
  // USER
  static async create(req, res) {
    const result = await ServiceRequestService.createRequest(req.user, req.body || {});
    return sendServiceResult(res, result, 201);
  }

  static async listMine(req, res) {
    const result = await ServiceRequestService.listMyRequests(req.user);
    return sendServiceResult(res, result);
  }

  static async listMyChats(req, res) {
    const result = await ServiceRequestService.listMyChats(req.user);
    return sendServiceResult(res, result);
  }

  static async listMyProChats(req, res) {
    const result = await ServiceRequestService.listMyProChats(req.user);
    return sendServiceResult(res, result);
  }

  static async cancel(req, res) {
    const result = await ServiceRequestService.cancelRequest(req.user, req.params.id);
    return sendServiceResult(res, result);
  }

  static async hide(req, res) {
    const result = await ServiceRequestService.hideRequest(req.user, req.params.id);
    return sendServiceResult(res, result);
  }

  static async finalize(req, res) {
    const result = await ServiceRequestService.finalizeResponse(
      req.user, req.params.id, req.params.id_response
    );
    return sendServiceResult(res, result);
  }

  static async userReject(req, res) {
    const result = await ServiceRequestService.userRejectResponse(
      req.user, req.params.id, req.params.id_response
    );
    return sendServiceResult(res, result);
  }

  // PRO
  static async mural(req, res) {
    const result = await ServiceRequestService.listMural(req.user, req.query.id_profile);
    return sendServiceResult(res, result);
  }

  static async respond(req, res) {
    const result = await ServiceRequestService.respond(req.user, req.params.id, req.body || {});
    if (result && result.error && result.status === 409) {
      const body = { error: result.error };
      if (result.locked_by_other) body.locked_by_other = true;
      return res.status(409).json(body);
    }
    return sendServiceResult(res, result);
  }

  static async markSeen(req, res) {
    const result = await ServiceRequestService.markMuralSeen(req.user, req.body || {});
    return sendServiceResult(res, result);
  }

  static async deleteChat(req, res) {
    const result = await ServiceRequestService.deleteChat(req.user, req.params.id_response);
    return sendServiceResult(res, result);
  }

  // Messages
  static async messages(req, res) {
    const result = await ServiceRequestService.listMessages(req.user, req.params.id_response);
    return sendServiceResult(res, result);
  }

  static async sendMessage(req, res) {
    const result = await ServiceRequestService.sendMessage(
      req.user, req.params.id_response, req.body || {}
    );
    return sendServiceResult(res, result, 201);
  }

  static async markRead(req, res) {
    const result = await ServiceRequestService.markRead(req.user, req.params.id_response);
    return sendServiceResult(res, result);
  }

  // Badges
  static async badgeProfile(req, res) {
    const result = await ServiceRequestService.badgeForProfile(req.user, req.query.id_profile);
    return sendServiceResult(res, result);
  }

  static async badgeMe(req, res) {
    const result = await ServiceRequestService.badgeForUser(req.user);
    return sendServiceResult(res, result);
  }
}

module.exports = ServiceRequestController;
