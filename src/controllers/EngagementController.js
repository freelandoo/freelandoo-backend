// src/controllers/EngagementController.js
const pool = require("../databases");
const EngagementStorage = require("../storages/EngagementStorage");

const RANGE_DAYS = { "7d": 7, "30d": 30, "90d": 90 };

module.exports = {
  // GET /me/engagement?scope=account|profile&id_profile=<uuid>&range=7d|30d|90d
  async getEngagement(req, res) {
    const id_user = req.user.id_user;
    const scope = req.query.scope === "profile" ? "profile" : "account";
    const id_profile = req.query.id_profile || null;

    const rangeKey = RANGE_DAYS[req.query.range] ? req.query.range : "30d";
    const days = RANGE_DAYS[rangeKey];
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const resolved = await EngagementStorage.resolveScope(pool, {
      id_user,
      scope,
      id_profile,
    });
    if (resolved.error) {
      return res.status(404).json({ error: resolved.error });
    }

    const data = await EngagementStorage.getEngagement(pool, {
      id_user,
      profile_ids: resolved.profile_ids,
      since,
    });

    return res.json({ range: rangeKey, scope, ...data });
  },
};
