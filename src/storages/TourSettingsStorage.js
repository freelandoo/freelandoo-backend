// src/storages/TourSettingsStorage.js
// Configuração singleton (id=1) do auto-tour de boas-vindas.
module.exports = {
  async getSettings(db) {
    const r = await db.query(`SELECT * FROM public.tour_settings WHERE id = 1 LIMIT 1`);
    // Default seguro caso a linha ainda não exista (boot antes do seed).
    return r.rowCount
      ? r.rows[0]
      : { id: 1, is_enabled: true, audience: "all", show_mode: "once" };
  },

  async updateSettings(db, { is_enabled, audience, show_mode, updated_by }) {
    const sets = ["updated_at = NOW()"];
    const vals = [];
    let i = 1;
    if (typeof is_enabled === "boolean") { sets.push(`is_enabled = $${i++}`); vals.push(is_enabled); }
    if (audience === "all" || audience === "admin") { sets.push(`audience = $${i++}`); vals.push(audience); }
    if (show_mode === "once" || show_mode === "always") { sets.push(`show_mode = $${i++}`); vals.push(show_mode); }
    if (updated_by) { sets.push(`updated_by = $${i++}`); vals.push(updated_by); }

    // Garante a linha singleton e aplica os campos válidos.
    await db.query(`INSERT INTO public.tour_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
    const r = await db.query(
      `UPDATE public.tour_settings SET ${sets.join(", ")} WHERE id = 1 RETURNING *`,
      vals
    );
    return r.rows[0];
  },

  // Decide se o tour deve auto-aparecer para este usuário, dada a config.
  // settings: linha de tour_settings; isAdmin: bool; tourDone: bool.
  shouldShow(settings, isAdmin, tourDone) {
    if (!settings || !settings.is_enabled) return false;
    if (settings.audience === "admin" && !isAdmin) return false;
    if (settings.show_mode === "always") return true;
    return tourDone === false; // 'once'
  },
};
