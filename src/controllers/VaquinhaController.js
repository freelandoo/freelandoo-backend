// src/controllers/VaquinhaController.js
const VaquinhaService = require("../services/VaquinhaService");
const { sendServiceResult } = require("../utils/sendServiceResult");

module.exports = {
  // ─── Dono (auth) ───────────────────────────────────────────────────────────
  async getMine(req, res) {
    return sendServiceResult(res, await VaquinhaService.getMine(req.user));
  },
  async create(req, res) {
    return sendServiceResult(res, await VaquinhaService.create(req.user, req.body || {}), 201);
  },
  async getOrCreate(req, res) {
    return sendServiceResult(res, await VaquinhaService.getOrCreate(req.user));
  },
  async update(req, res) {
    return sendServiceResult(res, await VaquinhaService.update(req.user, req.params.id, req.body || {}));
  },
  async uploadCover(req, res) {
    return sendServiceResult(res, await VaquinhaService.uploadCover(req.user, req.params.id, req.file || null));
  },
  async close(req, res) {
    return sendServiceResult(res, await VaquinhaService.close(req.user, req.params.id));
  },
  async createPost(req, res) {
    return sendServiceResult(res, await VaquinhaService.createPost(req.user, req.params.id, req.body || {}, req.file || null), 201);
  },
  async deletePost(req, res) {
    return sendServiceResult(res, await VaquinhaService.deletePost(req.user, req.params.postId));
  },

  // ─── Público ───────────────────────────────────────────────────────────────
  async getPublic(req, res) {
    return sendServiceResult(res, await VaquinhaService.getPublic(req.params.slug));
  },
  async listPosts(req, res) {
    return sendServiceResult(res, await VaquinhaService.listPosts(req.params.slug, req.query || {}));
  },
  async donate(req, res) {
    return sendServiceResult(res, await VaquinhaService.donate(req.user || null, req.params.slug, req.body || {}));
  },

  // ─── Admin ─────────────────────────────────────────────────────────────────
  async getSettings(req, res) {
    return sendServiceResult(res, await VaquinhaService.getSettings());
  },
  async updateSettings(req, res) {
    return sendServiceResult(res, await VaquinhaService.updateSettings(req.user, req.body || {}));
  },
};
