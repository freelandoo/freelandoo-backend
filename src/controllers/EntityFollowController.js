const EntityFollowService = require("../services/EntityFollowService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class EntityFollowController {
  static async listActors(req, res) {
    const result = await EntityFollowService.listActors(req.user);
    return sendServiceResult(res, result);
  }

  static async listMessageableActors(req, res) {
    const result = await EntityFollowService.listMessageableActors(req.user);
    return sendServiceResult(res, result);
  }

  static async mySummary(req, res) {
    const result = await EntityFollowService.mySummary(req.user);
    return sendServiceResult(res, result);
  }

  static async follow(req, res) {
    const result = await EntityFollowService.follow(req.user, req.body || {});
    return sendServiceResult(res, result, 201);
  }

  static async unfollow(req, res) {
    const result = await EntityFollowService.unfollow(req.user, {
      ...(req.body || {}),
      target_type: req.body?.target_type || req.params?.target_type,
      target_id: req.body?.target_id || req.params?.target_id,
    });
    return sendServiceResult(res, result);
  }

  static async status(req, res) {
    const result = await EntityFollowService.status(req.user, req.query || {});
    return sendServiceResult(res, result);
  }

  static async counts(req, res) {
    const result = await EntityFollowService.counts(req.query || {});
    return sendServiceResult(res, result);
  }

  static async followers(req, res) {
    const result = await EntityFollowService.followers(req.query || {});
    return sendServiceResult(res, result);
  }

  static async following(req, res) {
    const result = await EntityFollowService.following(req.query || {});
    return sendServiceResult(res, result);
  }
}

module.exports = EntityFollowController;
