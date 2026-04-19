const ProfileService = require("../services/ProfileService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class ProfileController {
  static async create(req, res) {
    const result = await ProfileService.create(req.user, req.body);
    return sendServiceResult(res, result, 201);
  }

  static async listByUser(req, res) {
    const result = await ProfileService.listByUser(req.params);
    return sendServiceResult(res, result);
  }

  static async getById(req, res) {
    const result = await ProfileService.getById(req.params);
    return sendServiceResult(res, result);
  }

  static async update(req, res) {
    const result = await ProfileService.update(req.user, req.params, req.body);
    return sendServiceResult(res, result);
  }

  static async remove(req, res) {
    const result = await ProfileService.remove(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async setStatus(req, res) {
    const result = await ProfileService.setStatus(
      req.user,
      req.params,
      req.body
    );
    return sendServiceResult(res, result);
  }
}

module.exports = ProfileController;
