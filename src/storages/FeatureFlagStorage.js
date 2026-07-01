// src/storages/FeatureFlagStorage.js
// Persistência das feature flags (Painel de Controle). Uma linha por
// responsabilidade (ex.: 'store'). Ver migration 168.
module.exports = {
  // Mapa enxuto { flag_key: is_enabled } — usado no request path (barato).
  async getMap(db) {
    const r = await db.query(`SELECT flag_key, is_enabled FROM public.tb_feature_flag`);
    const map = {};
    for (const row of r.rows) map[row.flag_key] = row.is_enabled;
    return map;
  },

  // Lista completa p/ a tela admin.
  async listFlags(db) {
    const r = await db.query(
      `SELECT flag_key, label, description, is_enabled, updated_at, updated_by
         FROM public.tb_feature_flag
        ORDER BY label ASC`
    );
    return r.rows;
  },

  async setFlag(db, key, isEnabled, updatedBy) {
    const r = await db.query(
      `UPDATE public.tb_feature_flag
          SET is_enabled = $2, updated_at = NOW(), updated_by = $3
        WHERE flag_key = $1
      RETURNING flag_key, label, description, is_enabled, updated_at, updated_by`,
      [key, isEnabled, updatedBy || null]
    );
    return r.rows[0] || null;
  },
};
