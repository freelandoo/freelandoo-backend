// src/controllers/VitrineController.js
// Camada fina de A2/A4 (mig 338): chaves da pessoa, aba Empregos e feed de
// boletos (com a moderação do admin).

const NeedsService = require("../services/NeedsService");
const DebtService = require("../services/DebtService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class VitrineController {
  /* chaves */
  static async needs(req, res) {
    return sendServiceResult(res, await NeedsService.mine(req.user));
  }
  static async updateNeeds(req, res) {
    return sendServiceResult(res, await NeedsService.update(req.user, req.body || {}));
  }

  /* abas da comunidade */
  static async communityJobs(req, res) {
    return sendServiceResult(res, await NeedsService.communityJobs(req.user, req.params, req.query || {}));
  }
  static async communityDebts(req, res) {
    return sendServiceResult(res, await DebtService.communityFeed(req.user, req.params, req.query || {}));
  }

  /* boletos */
  static async debtSettings(req, res) {
    return sendServiceResult(res, await DebtService.settings());
  }
  static async debtFeed(req, res) {
    return sendServiceResult(res, await DebtService.feed(req.user, req.query || {}));
  }
  static async debtMine(req, res) {
    return sendServiceResult(res, await DebtService.mine(req.user));
  }
  static async debtCreate(req, res) {
    return sendServiceResult(res, await DebtService.create(req.user, req.body || {}), 201);
  }
  static async debtCancel(req, res) {
    return sendServiceResult(res, await DebtService.cancel(req.user, req.params));
  }
  static async debtReserve(req, res) {
    return sendServiceResult(res, await DebtService.reserve(req.user, req.params));
  }
  static async debtRelease(req, res) {
    return sendServiceResult(res, await DebtService.release(req.user, req.params));
  }
  static async debtProof(req, res) {
    return sendServiceResult(res, await DebtService.submitProof(req.user, req.params, req.file), 201);
  }
  static async debtProofUrl(req, res) {
    return sendServiceResult(res, await DebtService.proofUrl(req.user, req.params));
  }
  static async debtConfirm(req, res) {
    return sendServiceResult(res, await DebtService.confirm(req.user, req.params));
  }
  static async debtRejectProof(req, res) {
    return sendServiceResult(res, await DebtService.rejectProof(req.user, req.params));
  }
  static async debtReport(req, res) {
    return sendServiceResult(res, await DebtService.report(req.user, req.params, req.body || {}), 201);
  }

  /* moderação */
  static async adminQueue(req, res) {
    return sendServiceResult(res, await DebtService.adminQueue());
  }
  static async adminReview(req, res) {
    return sendServiceResult(res, await DebtService.adminReview(req.user, req.params, req.body || {}));
  }
  static async adminRemove(req, res) {
    return sendServiceResult(res, await DebtService.adminRemove(req.user, req.params, req.body || {}));
  }
  static async adminResolveReports(req, res) {
    return sendServiceResult(res, await DebtService.adminResolveReports(req.user, req.params));
  }
  static async adminProofUrl(req, res) {
    return sendServiceResult(res, await DebtService.proofUrl(req.user, req.params, { admin: true }));
  }
  static async adminSettings(req, res) {
    return sendServiceResult(res, await DebtService.adminSettings());
  }
  static async adminUpdateSettings(req, res) {
    return sendServiceResult(res, await DebtService.adminUpdateSettings(req.user, req.body || {}));
  }
}

module.exports = VitrineController;
