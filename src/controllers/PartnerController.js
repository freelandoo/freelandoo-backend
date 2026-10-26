// src/controllers/PartnerController.js
// /partner/v1 — os services devolvem { status, body } já no formato do
// contrato (erros com `erro` de código estável). Ver docs/API_PARTNER.md.
const PartnerMemberService = require("../services/PartnerMemberService");
const PartnerWhatsappService = require("../services/PartnerWhatsappService");
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

  async remindTraining(req, res) {
    return send(res, await PartnerMemberService.remindProfessors(req.partnerAcademy));
  },

  // ─── WhatsApp oficial da academia (mig 307) ────────────────────────────────
  async whatsappStatus(req, res) {
    return send(res, await PartnerWhatsappService.status(req.partnerAcademy));
  },

  async whatsappWebhook(req, res) {
    return send(res, await PartnerWhatsappService.setWebhook(req.partnerAcademy, req.body || {}));
  },

  async whatsappSend(req, res) {
    return send(res, await PartnerWhatsappService.sendText(req.partnerAcademy, req.body || {}));
  },

  async whatsappMedia(req, res) {
    const r = await PartnerWhatsappService.media(req.partnerAcademy, req.params.media_id);
    if (!r.file) return send(res, r);
    res.setHeader("Content-Type", r.file.mime);
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).send(r.file.buffer);
  },

  // Dono da academia (JWT): ligar o próprio número oficial ao sistema dela.
  async whatsappForwardStatus(req, res) {
    return sendServiceResult(res, await PartnerWhatsappService.ownerStatus(req.user.id_user, req.params.id));
  },

  async whatsappForwardSet(req, res) {
    return sendServiceResult(
      res,
      await PartnerWhatsappService.ownerSetForward(req.user.id_user, req.params.id, (req.body || {}).ativo === true)
    );
  },

  // ─── Gestão da chave (dono logado) ─────────────────────────────────────────
  async generateKey(req, res) {
    return sendServiceResult(res, await PartnerMemberService.generateKey(req.user.id_user, req.params.id), 201);
  },

  async keyStatus(req, res) {
    return sendServiceResult(res, await PartnerMemberService.keyStatus(req.user.id_user, req.params.id));
  },
};
