// src/controllers/WorkoutController.js
const WorkoutService = require("../services/WorkoutService");
const sendServiceResult = require("../utils/sendServiceResult");

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
    const result = await WorkoutService.createPlan(req.user.id_user, req.params.id, req.params.memberId, req.body || {});
    return sendServiceResult(res, result, 201);
  },

  async updatePlan(req, res) {
    const result = await WorkoutService.updatePlan(req.user.id_user, req.params.planId, req.body || {});
    return sendServiceResult(res, result);
  },

  async deletePlan(req, res) {
    const result = await WorkoutService.deletePlan(req.user.id_user, req.params.planId);
    return sendServiceResult(res, result);
  },

  async trainingGrid(req, res) {
    const result = await WorkoutService.trainingGrid(req.user.id_user, req.params.id, req.query.date);
    return sendServiceResult(res, result);
  },
};
