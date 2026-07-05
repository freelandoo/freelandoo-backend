// src/controllers/AtendimentoIaController.js
const AtendimentoIaService = require("../services/AtendimentoIaService");
const { sendServiceResult } = require("../utils/sendServiceResult");

module.exports = {
  // ─── Vendedor ────────────────────────────────────────────────────────────
  async getMine(req, res) {
    return sendServiceResult(res, await AtendimentoIaService.getMine(req.user));
  },
  async createCheckout(req, res) {
    return sendServiceResult(res, await AtendimentoIaService.createCheckout(req.user, req.body || {}), 201);
  },
  async updateConfig(req, res) {
    return sendServiceResult(res, await AtendimentoIaService.updateConfig(req.user, req.body || {}));
  },
  async cancel(req, res) {
    return sendServiceResult(res, await AtendimentoIaService.cancel(req.user));
  },

  // ─── Admin ───────────────────────────────────────────────────────────────
  async adminListPlans(req, res) {
    return sendServiceResult(res, await AtendimentoIaService.adminListPlans());
  },
  async adminCreatePlan(req, res) {
    return sendServiceResult(res, await AtendimentoIaService.adminCreatePlan(req.user, req.body || {}), 201);
  },
  async adminUpdatePlan(req, res) {
    return sendServiceResult(res, await AtendimentoIaService.adminUpdatePlan(req.user, req.params.id_plan, req.body || {}));
  },
  async adminDeletePlan(req, res) {
    return sendServiceResult(res, await AtendimentoIaService.adminDeletePlan(req.user, req.params.id_plan));
  },
  async adminListSubs(req, res) {
    return sendServiceResult(res, await AtendimentoIaService.adminListSubs(req.query || {}));
  },
  async adminReprovision(req, res) {
    return sendServiceResult(res, await AtendimentoIaService.adminReprovision(req.user, req.params.id_sub));
  },
};
