// src/controllers/PartnerController.js
// /partner/v1 — os services devolvem { status, body } já no formato do
// contrato (erros com `erro` de código estável). Ver docs/API_PARTNER.md.
const PartnerMemberService = require("../services/PartnerMemberService");
const { sendServiceResult } = require("../utils/sendServiceResult");

function send(res, result) {
  return res.status(result.status).json(result.body);
}

module.exports = {
  async createMember(req, res) {
    return send(res, await PartnerMemberService.upsertMember(req.partnerAcademy, req.body || {}));
  },

  async regenerateLink(req, res) {
    return send(res, await PartnerMemberService.regenerateLink(req.partnerAcademy, req.params.id_user));
  },

  async uploadPhoto(req, res) {
    return send(res, await PartnerMemberService.uploadPhoto(req.partnerAcademy, req.params.id_user, req.file));
  },

  async listMembers(req, res) {
    return send(
      res,
      await PartnerMemberService.list(req.partnerAcademy, { cursor: req.query.cursor, limit: req.query.limit })
    );
  },

  async getMember(req, res) {
    return send(res, await PartnerMemberService.get(req.partnerAcademy, req.params.id_user));
  },

  // ─── Gestão da chave (dono logado) ─────────────────────────────────────────
  async generateKey(req, res) {
    return sendServiceResult(res, await PartnerMemberService.generateKey(req.user.id_user, req.params.id), 201);
  },

  async keyStatus(req, res) {
    return sendServiceResult(res, await PartnerMemberService.keyStatus(req.user.id_user, req.params.id));
  },
};
