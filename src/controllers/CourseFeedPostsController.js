const CourseFeedPostsService = require("../services/CourseFeedPostsService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class CourseFeedPostsController {
  static async get(req, res) {
    return sendServiceResult(
      res,
      await CourseFeedPostsService.get(req.user, req.params.id),
    );
  }

  static async publish(req, res) {
    return sendServiceResult(
      res,
      await CourseFeedPostsService.publish(req.user, req.params.id, req.body || {}),
      201,
    );
  }

  static async remove(req, res) {
    return sendServiceResult(
      res,
      await CourseFeedPostsService.remove(req.user, req.params.id),
    );
  }
}

module.exports = CourseFeedPostsController;
