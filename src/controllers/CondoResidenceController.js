// src/controllers/CondoResidenceController.js
// Camada fina: todo guard de papel/privacidade mora no CondoResidenceService.

const CondoResidenceService = require("../services/CondoResidenceService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class CondoResidenceController {
  /* --------------------------------- planta ------------------------------ */

  static async getPlant(req, res) {
    const result = await CondoResidenceService.getPlant(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async createBlock(req, res) {
    const result = await CondoResidenceService.createBlock(
      req.user,
      req.params,
      req.body || {}
    );
    return sendServiceResult(res, result, 201);
  }

  static async createUnit(req, res) {
    const result = await CondoResidenceService.createUnit(
      req.user,
      req.params,
      req.body || {}
    );
    return sendServiceResult(res, result, 201);
  }

  static async deleteUnit(req, res) {
    const result = await CondoResidenceService.deleteUnit(req.user, req.params);
    return sendServiceResult(res, result);
  }

  /* ----------------------------- reivindicação ---------------------------- */

  static async claimUnit(req, res) {
    const result = await CondoResidenceService.claimUnit(
      req.user,
      req.params,
      req.body || {}
    );
    return sendServiceResult(res, result, 201);
  }

  static async respondToClaim(req, res) {
    const result = await CondoResidenceService.respondToClaim(
      req.user,
      req.params,
      req.body || {}
    );
    return sendServiceResult(res, result);
  }

  /* -------------------------------- disputa ------------------------------- */

  static async listDisputes(req, res) {
    const result = await CondoResidenceService.listDisputes(
      req.user,
      req.params,
      req.query || {}
    );
    return sendServiceResult(res, result);
  }

  static async decideDispute(req, res) {
    const result = await CondoResidenceService.decideDispute(
      req.user,
      req.params,
      req.body || {}
    );
    return sendServiceResult(res, result);
  }

  // O vídeo chega por multipart (`file`) — não há PUT direto do browser para o
  // R2 aqui, ver o cabeçalho de integrations/r2/residenceProofStorage.js.
  static async submitProof(req, res) {
    const result = await CondoResidenceService.submitProof(
      req.user,
      req.params,
      req.file
    );
    return sendServiceResult(res, result, 201);
  }

  static async getProofUrl(req, res) {
    const result = await CondoResidenceService.getProofUrl(req.user, req.params);
    return sendServiceResult(res, result);
  }

  /* ------------------------------- vizinhos ------------------------------- */

  static async listResidents(req, res) {
    const result = await CondoResidenceService.listResidents(req.user, req.params);
    return sendServiceResult(res, result);
  }
}

module.exports = CondoResidenceController;
