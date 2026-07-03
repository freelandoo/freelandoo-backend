// src/controllers/ApiConnectionController.js
const ApiConnectionService = require("../services/ApiConnectionService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class ApiConnectionController {
  // req.connectionKind é injetado pela rota ('atendimento' | 'data').
  static async list(req, res) {
    const result = await ApiConnectionService.list(req.user, req.connectionKind);
    return sendServiceResult(res, result);
  }

  static async create(req, res) {
    const result = await ApiConnectionService.create(req.user, req.body, req.connectionKind);
    return sendServiceResult(res, result, 201);
  }

  static async revoke(req, res) {
    const result = await ApiConnectionService.revoke(req.user, req.params.id);
    return sendServiceResult(res, result);
  }
}

module.exports = ApiConnectionController;
