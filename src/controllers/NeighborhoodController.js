// src/controllers/NeighborhoodController.js
// Camada fina: os guards (morador reconhecido, flag, unicidade por bairro)
// moram no NeighborhoodService.

const NeighborhoodService = require("../services/NeighborhoodService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class NeighborhoodController {
  static async create(req, res) {
    const result = await NeighborhoodService.create(req.user, req.body || {});
    return sendServiceResult(res, result, 201);
  }

  static async join(req, res) {
    const result = await NeighborhoodService.join(req.user, {
      id_profile: req.params.id_profile,
    });
    return sendServiceResult(res, result);
  }

  static async discover(req, res) {
    const { uf, municipio, q, limit } = req.query || {};
    const result = await NeighborhoodService.discover({ uf, municipio, q, limit });
    return sendServiceResult(res, result);
  }

  static async mine(req, res) {
    const result = await NeighborhoodService.mine(req.user);
    return sendServiceResult(res, result);
  }
}

module.exports = NeighborhoodController;
