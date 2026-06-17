// src/controllers/TourSettingsController.js
const pool = require("../databases");
const TourSettingsStorage = require("../storages/TourSettingsStorage");

module.exports = {
  async get(req, res) {
    const settings = await TourSettingsStorage.getSettings(pool);
    return res.json({ settings });
  },

  async update(req, res) {
    const { is_enabled, audience, show_mode } = req.body || {};
    const settings = await TourSettingsStorage.updateSettings(pool, {
      is_enabled,
      audience,
      show_mode,
      updated_by: req.user.id_user,
    });
    return res.json({ settings });
  },
};
