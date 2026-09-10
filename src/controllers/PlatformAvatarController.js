const PlatformAvatarService = require("../services/PlatformAvatarService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class PlatformAvatarController {
  static async mine(req, res) {
    const result = await PlatformAvatarService.mine(req.user.id_user, req.params.kind);
    return sendServiceResult(res, result);
  }

  static async upload(req, res) {
    const result = await PlatformAvatarService.upload(req.user.id_user, req.params.kind, req.file);
    return sendServiceResult(res, result);
  }

  static async reset(req, res) {
    const result = await PlatformAvatarService.reset(req.user.id_user, req.params.kind);
    return sendServiceResult(res, result);
  }
}

module.exports = PlatformAvatarController;
