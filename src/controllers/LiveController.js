// src/controllers/LiveController.js
const LiveService = require("../services/LiveService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class LiveController {
  // GET /lives — lives ativas (faixa no Bees)
  static async listActive(req, res) {
    const result = await LiveService.listActive(req.user);
    return sendServiceResult(res, result);
  }

  // POST /lives — abre a live (token de transmissor)
  static async start(req, res) {
    const result = await LiveService.startLive(req.user, req.body || {});
    return sendServiceResult(res, result, 201);
  }

  // POST /lives/:id_live/end — encerra a live (só dono)
  static async end(req, res) {
    const result = await LiveService.endLive(req.user, req.params);
    return sendServiceResult(res, result);
  }

  // POST /lives/:id_live/join — entra como espectador (token de viewer)
  static async join(req, res) {
    const result = await LiveService.joinLive(req.user, req.params);
    return sendServiceResult(res, result);
  }
}

module.exports = LiveController;
