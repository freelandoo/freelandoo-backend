const CourseRequestService = require("../services/CourseRequestService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class CourseRequestController {
  static async create(req, res) {
    const result = await CourseRequestService.createRequest(req.user, req.body);
    return sendServiceResult(res, result);
  }

  static async listMine(req, res) {
    const result = await CourseRequestService.listMyRequests(req.user);
    return sendServiceResult(res, result);
  }

  static async listMyChats(req, res) {
    const result = await CourseRequestService.listMyChats(req.user);
    return sendServiceResult(res, result);
  }

  static async cancel(req, res) {
    const result = await CourseRequestService.cancelRequest(req.user, req.params.id);
    return sendServiceResult(res, result);
  }

  static async mural(req, res) {
    const id_profile = req.query.id_profile;
    const result = await CourseRequestService.listMural(req.user, id_profile);
    return sendServiceResult(res, result);
  }

  static async respond(req, res) {
    const result = await CourseRequestService.respond(req.user, req.params.id, req.body);
    return sendServiceResult(res, result);
  }

  static async messages(req, res) {
    const result = await CourseRequestService.listMessages(req.user, req.params.id_response);
    return sendServiceResult(res, result);
  }

  static async sendMessage(req, res) {
    const result = await CourseRequestService.sendMessage(req.user, req.params.id_response, req.body);
    return sendServiceResult(res, result);
  }

  static async markRead(req, res) {
    const result = await CourseRequestService.markRead(req.user, req.params.id_response);
    return sendServiceResult(res, result);
  }
}

module.exports = CourseRequestController;
