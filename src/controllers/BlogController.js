const BlogService = require("../services/BlogService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class BlogController {
  static async list(req, res) {
    res.set("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
    return sendServiceResult(res, await BlogService.listPublic(req.query || {}));
  }

  static async getBySlug(req, res) {
    res.set("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
    return sendServiceResult(res, await BlogService.getPublicBySlug(req.params.slug));
  }
}

module.exports = BlogController;
