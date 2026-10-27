// src/controllers/AcademyFeeController.js
// Calendário/mensalidades do aluno e o "Pagar pela Freelandoo" (mig 310):
// aluno, dono da academia (recebimentos e repasses) e admin (PIX manual).
const AcademyStudentService = require("../services/AcademyStudentService");
const AcademyFeeService = require("../services/AcademyFeeService");
const { sendServiceResult } = require("../utils/sendServiceResult");

module.exports = {
  // ── aluno ──
  async month(req, res) {
    const result = await AcademyStudentService.month(req.user.id_user, req.params.id_member, req.query.ym);
    return sendServiceResult(res, result);
  },

  async payments(req, res) {
    const result = await AcademyStudentService.payments(req.user.id_user, req.params.id_member);
    return sendServiceResult(res, result);
  },

  async pay(req, res) {
    const result = await AcademyFeeService.pay(req.user, req.params.id_member, req.params.external_id);
    return sendServiceResult(res, result);
  },

  // ── dono ──
  async getAccount(req, res) {
    const result = await AcademyFeeService.getAccount(req.user, req.params.id);
    return sendServiceResult(res, result);
  },

  async putAccount(req, res) {
    const result = await AcademyFeeService.putAccount(req.user, req.params.id, req.body || {});
    return sendServiceResult(res, result);
  },

  async deleteAccount(req, res) {
    const result = await AcademyFeeService.deleteAccount(req.user, req.params.id);
    return sendServiceResult(res, result);
  },

  async listPayouts(req, res) {
    const result = await AcademyFeeService.listPayouts(req.user, req.params.id);
    return sendServiceResult(res, result);
  },

  // ── admin ──
  async adminList(req, res) {
    const result = await AcademyFeeService.listAdmin(req.query || {});
    return sendServiceResult(res, result);
  },

  async adminMarkPaid(req, res) {
    const result = await AcademyFeeService.markPaidOut(req.user, req.params.id_payout, req.body || {});
    return sendServiceResult(res, result);
  },
};
