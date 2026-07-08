// src/controllers/AcademyController.js
const AcademyService = require("../services/AcademyService");
const AcademyLinkService = require("../services/AcademyLinkService");
const AcademySyncService = require("../services/AcademySyncService");
const { sendServiceResult } = require("../utils/sendServiceResult");

module.exports = {
  async create(req, res) {
    const result = await AcademyService.create(req.user.id_user, req.body || {});
    return sendServiceResult(res, result, 201);
  },

  async update(req, res) {
    const result = await AcademyService.update(req.user.id_user, req.params.id, req.body || {});
    return sendServiceResult(res, result);
  },

  async search(req, res) {
    const result = await AcademyService.search({ q: req.query.q, city: req.query.city });
    return res.json(result);
  },

  async getBySlug(req, res) {
    const viewerId = req.user ? req.user.id_user : null;
    const result = await AcademyService.getBySlug(req.params.slug, viewerId);
    return sendServiceResult(res, result);
  },

  async listMine(req, res) {
    const result = await AcademyService.listMine(req.user.id_user);
    return res.json(result);
  },

  async testConnection(req, res) {
    const result = await AcademyService.testConnection(req.user.id_user, req.params.id);
    return sendServiceResult(res, result);
  },

  async syncNow(req, res) {
    // Só o dono força sync manual.
    const guard = await AcademyService.assertStaff(req.params.id, req.user.id_user);
    if (guard.error) return sendServiceResult(res, guard);
    if (!guard.is_owner) return res.status(403).json({ error: "Sem permissão" });
    const result = await AcademySyncService.syncNow(req.params.id);
    return sendServiceResult(res, result);
  },

  async link(req, res) {
    const result = await AcademyLinkService.link(req.user.id_user, req.params.id, (req.body || {}).cpf);
    return sendServiceResult(res, result, 201);
  },

  async unlink(req, res) {
    const result = await AcademyLinkService.unlink(req.user.id_user, req.params.id);
    return sendServiceResult(res, result);
  },

  async myMemberships(req, res) {
    const result = await AcademyLinkService.myMemberships(req.user.id_user);
    return res.json(result);
  },

  async addProfessor(req, res) {
    const result = await AcademyService.addProfessor(req.user.id_user, req.params.id, (req.body || {}).id_user);
    return sendServiceResult(res, result, 201);
  },

  async removeProfessor(req, res) {
    const result = await AcademyService.removeProfessor(req.user.id_user, req.params.id, req.params.userId);
    return sendServiceResult(res, result);
  },

  async listMembers(req, res) {
    const result = await AcademyService.listMembers(req.user.id_user, req.params.id);
    return sendServiceResult(res, result);
  },
};
