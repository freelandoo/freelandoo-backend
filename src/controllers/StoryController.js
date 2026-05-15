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
}

module.exports = StoryController;
