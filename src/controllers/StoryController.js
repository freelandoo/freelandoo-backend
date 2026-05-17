const StoryService = require("../services/StoryService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class StoryController {
  static async listMine(req, res) {
    const result = await StoryService.listMine(req.user, req.query);
    return sendServiceResult(res, result);
  }

  static async createMine(req, res) {
    const result = await StoryService.createStory(
      req.user,
      { id_profile: req.body?.id_profile },
      req.body,
      req.file
    );
    return sendServiceResult(res, result, 201);
  }

  static async deleteMine(req, res) {
    const result = await StoryService.deleteMine(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async getFeed(req, res) {
    const result = await StoryService.getFeed(req.user, req.query);
    return sendServiceResult(res, result);
  }

  static async getByProfile(req, res) {
    const result = await StoryService.getByProfile(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async markViewed(req, res) {
    const result = await StoryService.markViewed(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async react(req, res) {
    const result = await StoryService.react(req.user, req.params, req.body || {});
    return sendServiceResult(res, result);
  }
}

module.exports = StoryController;
