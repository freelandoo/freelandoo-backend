// src/storages/GameSaveStorage.js — saves do EVO Brazil (mig 279).
const db = require("../databases");

class GameSaveStorage {
  static async list(id_user) {
    const { rows } = await db.query(
      `SELECT slot, summary, game_version, updated_at
         FROM public.tb_game_save WHERE id_user = $1 ORDER BY slot`,
      [id_user]
    );
    return rows;
  }

  static async get(id_user, slot) {
    const { rows } = await db.query(
      `SELECT slot, data, summary, game_version, updated_at
         FROM public.tb_game_save WHERE id_user = $1 AND slot = $2`,
      [id_user, slot]
    );
    return rows[0] || null;
  }

  static async put(id_user, slot, { data, summary, game_version }) {
    const { rows } = await db.query(
      `INSERT INTO public.tb_game_save (id_user, slot, data, summary, game_version)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)
       ON CONFLICT (id_user, slot) DO UPDATE
         SET data = EXCLUDED.data, summary = EXCLUDED.summary,
             game_version = EXCLUDED.game_version, updated_at = NOW()
       RETURNING slot, summary, game_version, updated_at`,
      [id_user, slot, JSON.stringify(data), JSON.stringify(summary), game_version]
    );
    return rows[0];
  }

  static async remove(id_user, slot) {
    const { rowCount } = await db.query(
      `DELETE FROM public.tb_game_save WHERE id_user = $1 AND slot = $2`,
      [id_user, slot]
    );
    return rowCount > 0;
  }
}

module.exports = GameSaveStorage;
