const BlogService = require("../services/BlogService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class BlogAdminController {
  static async list(req, res) {
    return sendServiceResult(res, await BlogService.adminList(req.user, req.query || {}));
  }

  static async get(req, res) {
    return sendServiceResult(res, await BlogService.adminGet(req.user, req.params.id));
  }

  static async create(req, res) {
    return sendServiceResult(res, await BlogService.create(req.user, req.body || {}, req.file), 201);
  }

  static async update(req, res) {
    return sendServiceResult(res, await BlogService.update(req.user, req.params.id, req.body || {}, req.file));
  }

  static async remove(req, res) {
    return sendServiceResult(res, await BlogService.remove(req.user, req.params.id));
  }

  static async uploadCover(req, res) {
    return sendServiceResult(res, await BlogService.uploadCover(req.user, req.file), 201);
  }
}

module.exports = BlogAdminController;
