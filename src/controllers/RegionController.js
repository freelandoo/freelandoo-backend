// src/controllers/RegionController.js
const pool = require("../databases");
const RegionStorage = require("../storages/RegionStorage");

module.exports = {
  // GET /regions?uf=SP → { regions: [{ id_region, name, ... }] }
  async list(req, res) {
    const uf = String(req.query.uf || "").trim().toUpperCase().slice(0, 2);
    if (!uf) return res.json({ regions: [] });
    const regions = await RegionStorage.listByUf(pool, uf);
    return res.json({ regions });
  },
};
