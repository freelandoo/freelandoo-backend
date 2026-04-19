const SocialMediaPublicService = require("../services/SocialMediaPublicService");

class SocialMediaPublicController {
  static async getMeta(req, res) {
    const result = await SocialMediaPublicService.getMeta();
    return res.json(result);
  }

  static async listTypes(req, res) {
    const result = await SocialMediaPublicService.listTypes();
    return res.json(result);
  }

  static async listFollowerRanges(req, res) {
    const result = await SocialMediaPublicService.listFollowerRanges();
    return res.json(result);
  }
}

module.exports = SocialMediaPublicController;
