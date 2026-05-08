// src/controllers/XpController.js
const pool = require("../databases");
const XpStorage = require("../storages/XpStorage");

module.exports = {
  // GET /admin/xp-settings
  async adminGetSettings(req, res) {
    const settings = await XpStorage.getSettings(pool);
    return res.json(settings);
  },

  // PUT /admin/xp-settings
  async adminUpdateSettings(req, res) {
    const settings = await XpStorage.updateSettings(pool, req.body, req.user.id_user);
    return res.json(settings);
  },

  // GET /subprofiles/:id/xp-summary  (público)
  async getXpSummary(req, res) {
    const { id } = req.params;
    const summary = await XpStorage.getXpSummary(pool, id);
    if (!summary) return res.status(404).json({ error: "Perfil não encontrado" });
    return res.json(summary);
  },

  // GET /subprofiles/:id/xp-events  (público)
  async getXpEvents(req, res) {
    const { id } = req.params;
    const limit = Math.min(parseInt(req.query.limit ?? "20", 10), 100);
    const offset = Math.max(parseInt(req.query.offset ?? "0", 10), 0);
    const events = await XpStorage.getXpEvents(pool, id, { limit, offset });
    return res.json(events);
  },
};
