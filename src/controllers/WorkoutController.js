// src/controllers/WorkoutController.js
// Mutações de ficha pelo staff (create/update/delete) viram PROPOSTA desde a
// mig 180 — o aluno confirma no /fitness. Respostas retornam { proposal }.
const WorkoutService = require("../services/WorkoutService");
const FitnessProposalService = require("../services/FitnessProposalService");
const { sendServiceResult } = require("../utils/sendServiceResult");

module.exports = {
  // Aluno
  async today(req, res) {
    const result = await WorkoutService.today(req.user.id_user, req.query.date);
    return sendServiceResult(res, result);
  },

  async toggleCheck(req, res) {
    const result = await WorkoutService.toggleCheck(req.user.id_user, req.body || {});
    return sendServiceResult(res, result);
  },

  async myPlans(req, res) {
    const result = await WorkoutService.myPlans(req.user.id_user);
    return res.json(result);
  },

  // Staff (professor/dono)
  async listExercises(req, res) {
    const result = await WorkoutService.listExercises(req.user.id_user, req.params.id, {
      muscle: req.query.muscle,
      q: req.query.q,
    });
    return sendServiceResult(res, result);
  },

  async memberPlans(req, res) {
    const result = await WorkoutService.memberPlans(req.user.id_user, req.params.id, req.params.memberId);
    return sendServiceResult(res, result);
  },

  async createPlan(req, res) {
    const result = await FitnessProposalService.propose(req.user.id_user, req.params.id, req.params.memberId, {
      ...(req.body || {}),
      kind: "plan_create",
    });
    return sendServiceResult(res, result, 201);
  },

  async updatePlan(req, res) {
    const result = await FitnessProposalService.proposeForPlan(
      req.user.id_user,
      req.params.id,
      req.params.planId,
      "plan_update",
      req.body || {}
    );
    return sendServiceResult(res, result, 201);
  },

  async deletePlan(req, res) {
    const result = await FitnessProposalService.proposeForPlan(
      req.user.id_user,
      req.params.id,
      req.params.planId,
      "plan_delete",
      req.body || {}
    );
    return sendServiceResult(res, result, 201);
  },

  async trainingGrid(req, res) {
    const result = await WorkoutService.trainingGrid(req.user.id_user, req.params.id, req.query.date);
    return sendServiceResult(res, result);
  },
};
