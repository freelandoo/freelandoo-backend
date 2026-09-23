// src/controllers/ProspectController.js
const ProspectService = require("../services/ProspectService");
const { sendServiceResult } = require("../utils/sendServiceResult");

module.exports = {
  async catalog(req, res) {
    return sendServiceResult(
      res,
      await ProspectService.catalog(req.user, req.params.id_profile)
    );
  },
  async search(req, res) {
    return sendServiceResult(
      res,
      await ProspectService.search(req.user, req.params.id_profile, req.query || {})
    );
  },
  async getCompany(req, res) {
    return sendServiceResult(
      res,
      await ProspectService.getCompany(req.user, req.params.id_profile, req.params.id_company)
    );
  },
  async discover(req, res) {
    return sendServiceResult(
      res,
      await ProspectService.requestDiscovery(req.user, req.params.id_profile, req.body || {}),
      202
    );
  },
  async enrich(req, res) {
    return sendServiceResult(
      res,
      await ProspectService.requestEnrichment(
        req.user,
        req.params.id_profile,
        req.params.id_company,
        req.body || {}
      ),
      202
    );
  },
  async jobs(req, res) {
    return sendServiceResult(res, await ProspectService.jobs(req.user, req.params.id_profile));
  },

  // ── listas ────────────────────────────────────────────────────────────────
  async listLists(req, res) {
    return sendServiceResult(res, await ProspectService.listLists(req.user, req.params.id_profile));
  },
  async createList(req, res) {
    return sendServiceResult(
      res,
      await ProspectService.createList(req.user, req.params.id_profile, req.body || {}),
      201
    );
  },
  async updateList(req, res) {
    return sendServiceResult(
      res,
      await ProspectService.updateList(
        req.user,
        req.params.id_profile,
        req.params.id_list,
        req.body || {}
      )
    );
  },
  async removeList(req, res) {
    return sendServiceResult(
      res,
      await ProspectService.removeList(req.user, req.params.id_profile, req.params.id_list)
    );
  },
  async listCompanies(req, res) {
    return sendServiceResult(
      res,
      await ProspectService.listCompanies(
        req.user,
        req.params.id_profile,
        req.params.id_list,
        req.query || {}
      )
    );
  },
  async addToList(req, res) {
    return sendServiceResult(
      res,
      await ProspectService.addToList(
        req.user,
        req.params.id_profile,
        req.params.id_list,
        req.body || {}
      ),
      201
    );
  },
  async removeFromList(req, res) {
    return sendServiceResult(
      res,
      await ProspectService.removeFromList(
        req.user,
        req.params.id_profile,
        req.params.id_list,
        req.params.id_company
      )
    );
  },
  async setStage(req, res) {
    return sendServiceResult(
      res,
      await ProspectService.setStage(
        req.user,
        req.params.id_profile,
        req.params.id_list,
        req.params.id_company,
        req.body || {}
      )
    );
  },

  // ── admin ─────────────────────────────────────────────────────────────────
  async suppress(req, res) {
    return sendServiceResult(res, await ProspectService.suppress(req.user, req.body || {}));
  },
};
