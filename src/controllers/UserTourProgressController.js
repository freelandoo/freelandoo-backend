const UserTourProgressService = require("../services/UserTourProgressService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class UserTourProgressController {
  static async list(req, res) {
    const result = await UserTourProgressService.list(req.user);
    return sendServiceResult(res, result);
  }

  static async start(req, res) {
    const result = await UserTourProgressService.start(req.user, req.body);
    return sendServiceResult(res, result);
  }

  static async complete(req, res) {
    const result = await UserTourProgressService.complete(req.user, req.body);
    return sendServiceResult(res, result);
  }

  static async skip(req, res) {
    const result = await UserTourProgressService.skip(req.user, req.body);
    return sendServiceResult(res, result);
  }

  static async reset(req, res) {
    const result = await UserTourProgressService.reset(req.user, req.body);
    return sendServiceResult(res, result);
  }

  static async updateSettings(req, res) {
    const result = await UserTourProgressService.updateSettings(req.user, req.body);
    return sendServiceResult(res, result);
  }
}

module.exports = UserTourProgressController;
