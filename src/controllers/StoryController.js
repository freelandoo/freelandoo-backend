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

  // Câmera (presigned/GPU-local): passo 1 — gerar URLs de upload direto pro R2.
  static async createUploadUrl(req, res) {
    const result = await StoryService.createUploadUrls(req.user, req.body || {});
    return sendServiceResult(res, result);
  }

  // Câmera: passo 1b — fallback do PUT direto (bucket sem CORS): o backend
  // recebe o blob e grava no R2 na mesma key assinada.
  static async uploadProxy(req, res) {
    const result = await StoryService.uploadProxy(req.user, req.body || {}, req.file);
    return sendServiceResult(res, result);
  }

  // Câmera: passo 2 — registrar a story a partir do objeto já enviado pro R2.
  static async createFromUpload(req, res) {
    const result = await StoryService.createStoryFromUpload(req.user, req.body || {});
    return sendServiceResult(res, result, 201);
  }

  static async getFeed(req, res) {
    const result = await StoryService.getFeed(req.user, req.query);
    return sendServiceResult(res, result);
  }

  static async getByProfile(req, res) {
    const result = await StoryService.getByProfile(req.user, req.params);
    return sendServiceResult(res, result);
  }

  // Player agrupado por user (StoryBar v2): bees vivos de todos os subperfis.
  static async getByUser(req, res) {
    const result = await StoryService.getByUser(req.user, req.params);
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
