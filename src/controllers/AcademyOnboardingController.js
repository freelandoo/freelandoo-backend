// src/controllers/AcademyOnboardingController.js
// Primeiro acesso (anônimo, pelo token do link) e aceite/recusa (logado) da
// conta criada pela academia — mig 296.
const AcademyOnboardingService = require("../services/AcademyOnboardingService");
const { sendServiceResult } = require("../utils/sendServiceResult");

function sendWithReason(res, result, okStatus = 200) {
  if (result && result.error) {
    return res.status(result.statusCode || 400).json({ error: result.error, reason: result.reason || null });
  }
  return res.status(okStatus).json(result);
}

module.exports = {
  async firstAccessInfo(req, res) {
    return res.json(await AcademyOnboardingService.firstAccessInfo(req.params.token));
  },

  async completeFirstAccess(req, res) {
    return sendWithReason(res, await AcademyOnboardingService.completeFirstAccess(req.body));
  },

  async state(req, res) {
    return sendServiceResult(res, await AcademyOnboardingService.state(req.user.id_user));
  },

  async photo(req, res) {
    const result = await AcademyOnboardingService.photo(req.user.id_user);
    if (result.error) return sendServiceResult(res, result);
    res.setHeader("Content-Type", result.contentType);
    // Dado privado até o aceite: nada de cache compartilhado.
    res.setHeader("Cache-Control", "private, no-store");
    if (typeof result.stream?.pipe === "function") return result.stream.pipe(res);
    if (result.stream?.transformToByteArray) {
      return res.end(Buffer.from(await result.stream.transformToByteArray()));
    }
    return res.end(result.stream);
  },

  async accept(req, res) {
    const result = await AcademyOnboardingService.accept(req.user.id_user, req.body || {}, {
      ip: req.ip,
      user_agent: req.get("user-agent") || null,
    });
    return sendWithReason(res, result);
  },

  async refuse(req, res) {
    return sendWithReason(res, await AcademyOnboardingService.refuse(req.user.id_user));
  },
};
