// src/controllers/ResidenceController.js
// Camada fina: todo guard de residência (quem julga, quem vê vizinho, quem é
// menor) mora no ResidenceService.

const ResidenceService = require("../services/ResidenceService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class ResidenceController {
  static async claim(req, res) {
    const { cep, numero, complemento } = req.body || {};
    const result = await ResidenceService.claim({
      id_user: req.user?.id_user,
      cep,
      numero,
      complemento,
    });
    return sendServiceResult(res, result, 201);
  }

  static async listMine(req, res) {
    const result = await ResidenceService.listMine(req.user?.id_user);
    return sendServiceResult(res, result);
  }

  static async listPending(req, res) {
    const result = await ResidenceService.listPending(req.user?.id_user);
    return sendServiceResult(res, result);
  }

  static async listNeighbors(req, res) {
    const result = await ResidenceService.listNeighbors({
      id_unit: req.params.id_unit,
      id_user: req.user?.id_user,
    });
    return sendServiceResult(res, result);
  }

  static async recognize(req, res) {
    const result = await ResidenceService.recognize({
      id_residence: req.params.id_residence,
      id_user: req.user?.id_user,
    });
    return sendServiceResult(res, result);
  }

  static async contest(req, res) {
    const result = await ResidenceService.contest({
      id_residence: req.params.id_residence,
      id_user: req.user?.id_user,
      reason: (req.body || {}).reason,
    });
    return sendServiceResult(res, result);
  }

  static async leave(req, res) {
    const result = await ResidenceService.leave({
      id_residence: req.params.id_residence,
      id_user: req.user?.id_user,
      reason: (req.body || {}).reason,
    });
    return sendServiceResult(res, result);
  }

  static async submitProof(req, res) {
    // O arquivo já subiu para o R2 pelo middleware; aqui viaja só a chave.
    const storage_key = req.file?.key || (req.body || {}).storage_key;
    const result = await ResidenceService.submitProof({
      id_residence: req.params.id_residence,
      id_user: req.user?.id_user,
      storage_key,
    });
    return sendServiceResult(res, result, 201);
  }

  /* --------------------------------- admin -------------------------------- */

  static async listProofQueue(req, res) {
    const result = await ResidenceService.listProofQueue(req.query || {});
    return sendServiceResult(res, result);
  }

  static async decideProof(req, res) {
    const { status, note } = req.body || {};
    const result = await ResidenceService.decideProof({
      id_proof: req.params.id_proof,
      status,
      note,
      admin_user_id: req.user?.id_user,
    });
    return sendServiceResult(res, result);
  }
}

module.exports = ResidenceController;
