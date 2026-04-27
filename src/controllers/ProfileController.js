const ProfileService = require("../services/ProfileService");
const UploadProfileAvatarService = require("../services/profile/UploadProfileAvatarService");
const pool = require("../databases");
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

  static async getPublicByHandle(req, res) {
    const result = await ProfileService.getPublicByHandle(req.params);
    return sendServiceResult(res, result);
  }

  static async resolveCanonicalByHandle(req, res) {
    const result = await ProfileService.resolveCanonicalByHandle(req.params);
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

  static async setVisibility(req, res) {
    const result = await ProfileService.setVisibility(
      req.user,
      req.params,
      req.body
    );
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

  static async uploadAvatar(req, res) {
    const { id_user } = req.user;
    const result = await UploadProfileAvatarService.execute({
      db: pool,
      id_user,
      params: req.params,
      file: req.file,
    });
    return res.status(200).json(result);
  }
}

module.exports = ProfileController;
