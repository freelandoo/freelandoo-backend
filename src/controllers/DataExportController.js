// src/controllers/DataExportController.js
// Controller fino da API de Dados. req.user = dono do token (injetado pelo
// apiConnectionAuth). Todos os endpoints são GET puros.
const DataExportService = require("../services/DataExportService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class DataExportController {
  static async me(req, res) {
    return sendServiceResult(res, await DataExportService.me(req.user));
  }
  static async profiles(req, res) {
    return sendServiceResult(res, await DataExportService.profiles(req.user));
  }
  static async services(req, res) {
    return sendServiceResult(res, await DataExportService.services(req.user));
  }
  static async products(req, res) {
    return sendServiceResult(res, await DataExportService.products(req.user));
  }
  static async social(req, res) {
    return sendServiceResult(res, await DataExportService.social(req.user));
  }
  static async courses(req, res) {
    return sendServiceResult(res, await DataExportService.courses(req.user));
  }
  static async metrics(req, res) {
    return sendServiceResult(res, await DataExportService.metrics(req.user));
  }
}

module.exports = DataExportController;
