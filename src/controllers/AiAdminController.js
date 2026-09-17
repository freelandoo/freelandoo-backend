// src/controllers/AiAdminController.js
const AiSettingsService = require("../services/AiSettingsService");
const { sendServiceResult } = require("../utils/sendServiceResult");

module.exports = {
  async settings(req, res) {
    return sendServiceResult(res, await AiSettingsService.getSettings());
  },
  async saveKey(req, res) {
    return sendServiceResult(
      res,
      await AiSettingsService.saveKey(req.user, req.params.provider, req.body || {})
    );
  },
  async removeKey(req, res) {
    return sendServiceResult(res, await AiSettingsService.removeKey(req.params.provider));
  },
  async testKey(req, res) {
    return sendServiceResult(res, await AiSettingsService.testKey(req.params.provider));
  },
  async usage(req, res) {
    return sendServiceResult(res, await AiSettingsService.usage(req.query || {}));
  },
  async jobs(req, res) {
    return sendServiceResult(res, await AiSettingsService.jobs(req.query || {}));
  },
};
