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

  // POST /lives/:id_live/viewers — transmissor reporta contagem (atualiza pico)
  static async reportViewers(req, res) {
    const result = await LiveService.reportViewers(req.user, req.params, req.body || {});
    return sendServiceResult(res, result);
  }

  // GET /lives/gifts — catálogo de presentes ativos
  static async listGifts(req, res) {
    const result = await LiveService.listGifts();
    return sendServiceResult(res, result);
  }

  // POST /lives/:id_live/gift — envia presente (gasta Poléns)
  static async sendGift(req, res) {
    const result = await LiveService.sendGift(req.user, req.params, req.body || {});
    return sendServiceResult(res, result, 201);
  }
}

module.exports = LiveController;
