const ClassificacaoService = require("../services/ClassificacaoService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class ClassificacaoController {
  static async me(req, res) {
    return sendServiceResult(res, await ClassificacaoService.me(req.user.id_user));
  }

  static async start(req, res) {
    const locale = req.body?.locale || req.query?.locale;
    return sendServiceResult(res, await ClassificacaoService.start(req.user.id_user, locale));
  }

  static async answer(req, res) {
    const id = Number(req.params.id_attempt);
    if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: "Prova não encontrada." });
    return sendServiceResult(res, await ClassificacaoService.answer(req.user.id_user, id, req.body));
  }

  static async visibility(req, res) {
    return sendServiceResult(res, await ClassificacaoService.setVisibility(req.user.id_user, req.body?.visibility));
  }

  static async publicByToken(req, res) {
    return sendServiceResult(res, await ClassificacaoService.publicByToken(req.params.token));
  }

  static async publicByUsername(req, res) {
    return sendServiceResult(res, await ClassificacaoService.publicByUsername(req.params.username));
  }

  static async personality(req, res) {
    return sendServiceResult(res, await ClassificacaoService.personality(req.user.id_user));
  }

  static async consent(req, res) {
    return sendServiceResult(res, await ClassificacaoService.grantConsent(req.user.id_user, req.body?.version));
  }

  static async savePersonality(req, res) {
    return sendServiceResult(res, await ClassificacaoService.savePersonality(req.user.id_user, req.body?.answers));
  }

  static async deletePersonality(req, res) {
    return sendServiceResult(res, await ClassificacaoService.deletePersonality(req.user.id_user));
  }
}

module.exports = ClassificacaoController;
