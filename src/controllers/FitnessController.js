// src/controllers/FitnessController.js
const FitnessService = require("../services/FitnessService");
const FitnessProposalService = require("../services/FitnessProposalService");
const { sendServiceResult } = require("../utils/sendServiceResult");

module.exports = {
  async summary(req, res) {
    const result = await FitnessService.summary(req.user.id_user, req.query.date);
    return sendServiceResult(res, result);
  },

  async indicators(req, res) {
    const result = await FitnessService.indicators(req.user.id_user);
    return sendServiceResult(res, result);
  },

  async searchFoods(req, res) {
    const result = await FitnessService.searchFoods(req.query.q);
    return res.json(result);
  },

  async searchOff(req, res) {
    const result = await FitnessService.searchOff(req.query.q);
    return sendServiceResult(res, result);
  },

  async cacheOffFood(req, res) {
    const result = await FitnessService.cacheOffFood(req.body || {});
    return sendServiceResult(res, result, 201);
  },

  async createCustomFood(req, res) {
    const result = await FitnessService.createCustomFood(req.user.id_user, req.body || {});
    return sendServiceResult(res, result, 201);
  },

  async addFoodLog(req, res) {
    const result = await FitnessService.addFoodLog(req.user.id_user, req.body || {});
    return sendServiceResult(res, result, 201);
  },

  async deleteFoodLog(req, res) {
    const result = await FitnessService.deleteFoodLog(req.user.id_user, req.params.id);
    return sendServiceResult(res, result);
  },

  async setWater(req, res) {
    const result = await FitnessService.setWater(req.user.id_user, req.body || {});
    return sendServiceResult(res, result);
  },

  async addMeasurement(req, res) {
    const result = await FitnessService.addMeasurement(req.user.id_user, req.body || {});
    return sendServiceResult(res, result, 201);
  },

  async listMeasurements(req, res) {
    const result = await FitnessService.listMeasurements(req.user.id_user);
    return res.json(result);
  },

  // Desde a mig 180 a avaliação do professor vira PROPOSTA (aluno confirma).
  async addMemberMeasurement(req, res) {
    const result = await FitnessProposalService.propose(req.user.id_user, req.params.id, req.params.memberId, {
      ...(req.body || {}),
      kind: "measurement",
    });
    return sendServiceResult(res, result, 201);
  },

  async setSettings(req, res) {
    const result = await FitnessService.setSettings(req.user.id_user, req.body || {});
    return sendServiceResult(res, result);
  },
};
