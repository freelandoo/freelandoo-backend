// src/controllers/FitnessProposalController.js
const FitnessProposalService = require("../services/FitnessProposalService");
const sendServiceResult = require("../utils/sendServiceResult");

module.exports = {
  // ─── Staff (professor/dono) ────────────────────────────────────────────────
  async propose(req, res) {
    const result = await FitnessProposalService.propose(
      req.user.id_user,
      req.params.id,
      req.params.memberId,
      req.body || {}
    );
    return sendServiceResult(res, result, 201);
  },

  async listForMember(req, res) {
    const result = await FitnessProposalService.listForMember(req.user.id_user, req.params.id, req.params.memberId);
    return sendServiceResult(res, result);
  },

  async cancel(req, res) {
    const result = await FitnessProposalService.cancel(req.user.id_user, req.params.id, req.params.proposalId);
    return sendServiceResult(res, result);
  },

  // ─── Aluno ─────────────────────────────────────────────────────────────────
  async listForStudent(req, res) {
    const result = await FitnessProposalService.listForStudent(req.user.id_user);
    return res.json(result);
  },

  async resolve(req, res) {
    const result = await FitnessProposalService.resolve(req.user.id_user, req.body || {});
    return sendServiceResult(res, result);
  },
};
