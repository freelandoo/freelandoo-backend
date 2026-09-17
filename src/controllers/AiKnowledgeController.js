// src/controllers/AiKnowledgeController.js
const AiKnowledgeService = require("../services/AiKnowledgeService");
const { sendServiceResult } = require("../utils/sendServiceResult");

module.exports = {
  async list(req, res) {
    return sendServiceResult(res, await AiKnowledgeService.list(req.user));
  },
  async createText(req, res) {
    return sendServiceResult(res, await AiKnowledgeService.createText(req.user, req.body || {}), 201);
  },
  async createPdf(req, res) {
    return sendServiceResult(
      res,
      await AiKnowledgeService.createFromPdf(req.user, req.file, req.body || {}),
      201
    );
  },
  async update(req, res) {
    return sendServiceResult(
      res,
      await AiKnowledgeService.update(req.user, req.params.id_knowledge, req.body || {})
    );
  },
  async remove(req, res) {
    return sendServiceResult(res, await AiKnowledgeService.remove(req.user, req.params.id_knowledge));
  },
  async preview(req, res) {
    return sendServiceResult(res, await AiKnowledgeService.preview(req.user));
  },
};
