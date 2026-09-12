const ManagedSiteService = require("../services/ManagedSiteService");
const { sendServiceResult } = require("../utils/sendServiceResult");

// ⚠️ `sendServiceResult` entra por DESTRUCTURING. Importado como objeto, a
// chamada vira "não é função" e TODA resposta deste controller sai 500 — foi o
// que aconteceu com os cinco controllers de academia (back `5f3c831`).

class ManagedSiteController {
  static async listTemplates(req, res) {
    const result = await ManagedSiteService.listTemplates();
    return sendServiceResult(res, result);
  }

  static async list(req, res) {
    const result = await ManagedSiteService.list();
    return sendServiceResult(res, result);
  }

  static async get(req, res) {
    const result = await ManagedSiteService.get(req.params);
    return sendServiceResult(res, result);
  }

  static async draftFromCanvas(req, res) {
    const result = await ManagedSiteService.draftFromCanvas(req.params, req.query || {});
    return sendServiceResult(res, result);
  }

  static async apply(req, res) {
    const result = await ManagedSiteService.apply(req.params, req.body || {});
    return sendServiceResult(res, result);
  }

  static async setPublished(req, res) {
    const result = await ManagedSiteService.setPublished(req.params, req.body || {});
    return sendServiceResult(res, result);
  }

  static async release(req, res) {
    const result = await ManagedSiteService.release(req.params);
    return sendServiceResult(res, result);
  }
}

module.exports = ManagedSiteController;
