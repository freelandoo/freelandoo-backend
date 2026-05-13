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

  // ─── Mídias do serviço ─────────────────────────────────────────────

  static async uploadMedia(req, res) {
    const result = await ProfileServiceService.uploadMedia(req.user, req.params, req.file);
    return sendServiceResult(res, result, 201);
  }

  static async deleteMedia(req, res) {
    const result = await ProfileServiceService.deleteMedia(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async listMedia(req, res) {
    const result = await ProfileServiceService.listMedia(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async reorderMedia(req, res) {
    const result = await ProfileServiceService.reorderMedia(req.user, req.params, req.body);
    return sendServiceResult(res, result);
  }
}

module.exports = ProfileServiceController;
