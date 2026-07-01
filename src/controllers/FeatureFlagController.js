// src/controllers/FeatureFlagController.js
const pool = require("../databases");
const FeatureFlagStorage = require("../storages/FeatureFlagStorage");
const FeatureFlagService = require("../services/FeatureFlagService");

module.exports = {
  // Público: mapa { flag_key: is_enabled } consumido pelo FeatureFlagsProvider
  // do front para esconder as superfícies das responsabilidades desligadas.
  async publicMap(req, res) {
    const flags = await FeatureFlagService.getMap();
    return res.json({ flags });
  },

  // Admin: lista completa (label/descrição/atualização) p/ o Painel de Controle.
  async listAdmin(req, res) {
    const flags = await FeatureFlagStorage.listFlags(pool);
    return res.json({ flags });
  },

  // Admin: liga/desliga uma responsabilidade.
  async update(req, res) {
    const { key } = req.params;
    const { is_enabled } = req.body || {};
    if (typeof is_enabled !== "boolean") {
      return res.status(400).json({ error: "is_enabled deve ser boolean." });
    }
    const flag = await FeatureFlagStorage.setFlag(pool, key, is_enabled, req.user.id_user);
    if (!flag) return res.status(404).json({ error: "Flag não encontrada." });
    FeatureFlagService.invalidate();
    return res.json({ flag });
  },
};
