const ProfileServiceService = require("../services/ProfileServiceService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class ProfileServiceController {
  static async list(req, res) {
    const result = await ProfileServiceService.list(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async create(req, res) {
    const result = await ProfileServiceService.create(req.user, req.params, req.body);
    return sendServiceResult(res, result, 201);
  }

  static async update(req, res) {
    const result = await ProfileServiceService.update(req.user, req.params, req.body);
    return sendServiceResult(res, result);
  }

  static async remove(req, res) {
    const result = await ProfileServiceService.remove(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async listPublic(req, res) {
    const result = await ProfileServiceService.listPublic(req.params.id_profile);
    return sendServiceResult(res, result);
  }
}

module.exports = ProfileServiceController;
