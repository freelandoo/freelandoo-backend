// src/controllers/AcademySocialController.js
const AcademySocialService = require("../services/AcademySocialService");
const sendServiceResult = require("../utils/sendServiceResult");

module.exports = {
  async listPosts(req, res) {
    const result = await AcademySocialService.listPosts(req.params.id, {
      before: req.query.before,
      limit: req.query.limit,
    });
    return sendServiceResult(res, result);
  },

  async createPost(req, res) {
    const result = await AcademySocialService.createPost(req.user, req.params.id, req.body || {}, req.file);
    return sendServiceResult(res, result, 201);
  },

  async deletePost(req, res) {
    const result = await AcademySocialService.deletePost(req.user, req.params.id, req.params.postId);
    return sendServiceResult(res, result);
  },

  async sharePost(req, res) {
    const result = await AcademySocialService.sharePost(req.params.id, req.params.postId);
    return sendServiceResult(res, result);
  },

  async getGoals(req, res) {
    const result = await AcademySocialService.getGoals(req.params.id);
    return res.json(result);
  },

  async setGoals(req, res) {
    const result = await AcademySocialService.setGoals(req.user.id_user, req.params.id, req.body || {});
    return sendServiceResult(res, result);
  },

  async ranking(req, res) {
    const result = await AcademySocialService.ranking(req.params.id, req.query.month);
    return sendServiceResult(res, result);
  },

  async uploadMedia(req, res) {
    const result = await AcademySocialService.uploadMedia(req.user.id_user, req.params.id, (req.body || {}).kind, req.file);
    return sendServiceResult(res, result, 201);
  },
};
