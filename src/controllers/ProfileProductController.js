const ProfileProductService = require("../services/ProfileProductService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class ProfileProductController {
  static async list(req, res) {
    const result = await ProfileProductService.list(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async create(req, res) {
    const result = await ProfileProductService.create(req.user, req.params, req.body);
    return sendServiceResult(res, result, 201);
  }

  static async update(req, res) {
    const result = await ProfileProductService.update(req.user, req.params, req.body);
    return sendServiceResult(res, result);
  }

  static async remove(req, res) {
    const result = await ProfileProductService.remove(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async listPublic(req, res) {
    const result = await ProfileProductService.listPublic(req.params.id_profile);
    return sendServiceResult(res, result);
  }

  static async getPublicById(req, res) {
    const result = await ProfileProductService.getPublicById(
      req.params.id_profile,
      req.params.id_profile_product
    );
    return sendServiceResult(res, result);
  }

  // ─── Mídias ──────────────────────────────────────────────────────────
  static async uploadMedia(req, res) {
    const result = await ProfileProductService.uploadMedia(req.user, req.params, req.file);
    return sendServiceResult(res, result, 201);
  }

  static async deleteMedia(req, res) {
    const result = await ProfileProductService.deleteMedia(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async listMedia(req, res) {
    const result = await ProfileProductService.listMedia(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async reorderMedia(req, res) {
    const result = await ProfileProductService.reorderMedia(req.user, req.params, req.body);
    return sendServiceResult(res, result);
  }
}

module.exports = ProfileProductController;
