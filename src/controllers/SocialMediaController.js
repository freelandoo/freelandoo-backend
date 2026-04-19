const SocialMediaService = require("../services/SocialMediaService");

class SocialMediaController {
  static reply(res, result, successStatus = 200) {
    if (result?.error) {
      const message = String(result.error).toLowerCase();

      if (message.includes("não autenticado")) {
        return res.status(401).json(result);
      }

      if (message.includes("não encontrado")) {
        return res.status(404).json(result);
      }

      if (message.includes("permissão")) {
        return res.status(403).json(result);
      }

      return res.status(400).json(result);
    }

    return res.status(successStatus).json(result);
  }

  static async upsert(req, res) {
    const result = await SocialMediaService.upsert(
      req.user,
      req.params,
      req.body
    );
    return SocialMediaController.reply(res, result);
  }

  static async updateByType(req, res) {
    const result = await SocialMediaService.updateByType(
      req.user,
      req.params,
      req.body
    );
    return SocialMediaController.reply(res, result);
  }

  static async disableByType(req, res) {
    const result = await SocialMediaService.disableByType(req.user, req.params);
    return SocialMediaController.reply(res, result);
  }
}

module.exports = SocialMediaController;
