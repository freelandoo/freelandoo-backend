// src/storages/MeuMundoAdventureStorage.js — MEU MUNDO 3D mm3d-59 (mig 320).
//
// Só SQL: XP de aventura, recibos e tickets de luta. Quem chama já está na
// transação de `MeuMundoLifeService.withLife` (advisory lock da pessoa), então
// as leituras aqui são serializadas por pessoa.

const iso = (v) => (v == null ? null : new Date(v).toISOString());

function receiptOut(r) {
  if (!r) return null;
  return {
    eventId: r.id_receipt,
    source: r.source,
    actionKey: r.action_key,
    rules: r.rules_version,
    activeMs: r.active_ms,
    result: r.result,
    deltas: r.deltas,
    items: r.items,
    at: iso(r.created_at),
  };
}

class MeuMundoAdventureStorage {
  /** Linha da aventura da pessoa (cria na 1ª vez), travada. */
  static async lockAdventure(c, idUser) {
    await c.query(`INSERT INTO tb_mm_adventure (id_user) VALUES ($1) ON CONFLICT (id_user) DO NOTHING`, [idUser]);
    const r = await c.query(`SELECT * FROM tb_mm_adventure WHERE id_user = $1 FOR UPDATE`, [idUser]);
    return r.rows[0];
  }

  static async getAdventure(c, idUser) {
    const r = await c.query(`SELECT * FROM tb_mm_adventure WHERE id_user = $1`, [idUser]);
    return r.rows[0] || { xp: 0, level: 1, losses: 0, losses_day: null };
  }

  static async saveAdventure(c, idUser, { xp, level, losses, lossesDay }) {
    await c.query(
      `UPDATE tb_mm_adventure SET xp = $2, level = $3, losses = $4, losses_day = $5, updated_at = NOW() WHERE id_user = $1`,
      [idUser, xp, level, losses, lossesDay]
    );
  }

  static async findReceipt(c, idCharacter, source, actionKey) {
    const r = await c.query(
      `SELECT * FROM tb_mm_receipt WHERE id_character = $1 AND source = $2 AND action_key = $3`,
      [idCharacter, source, actionKey]
    );
    return receiptOut(r.rows[0]);
  }

  /** Grava o recibo; se outro igual entrou antes (corrida entre abas), devolve null. */
  static async insertReceipt(c, rec) {
    const r = await c.query(
      `INSERT INTO tb_mm_receipt (id_user, id_character, source, action_key, rules_version, active_ms, result, deltas, items)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id_character, source, action_key) DO NOTHING
       RETURNING *`,
      [
        rec.idUser,
        rec.idCharacter,
        rec.source,
        rec.actionKey,
        rec.rules,
        Math.max(0, Math.round(rec.activeMs || 0)),
        JSON.stringify(rec.result || {}),
        JSON.stringify(rec.deltas || {}),
        JSON.stringify(rec.items || []),
      ]
    );
    return receiptOut(r.rows[0]);
  }

  static async recentReceipts(c, idUser, limit = 20) {
    const r = await c.query(`SELECT * FROM tb_mm_receipt WHERE id_user = $1 ORDER BY created_at DESC LIMIT $2`, [idUser, limit]);
    return r.rows.map(receiptOut);
  }

  static async insertFight(c, { idUser, idCharacter, origin, setup, ttlMs }) {
    const r = await c.query(
      `INSERT INTO tb_mm_fight (id_user, id_character, origin, setup, expires_at)
       VALUES ($1, $2, $3, $4, NOW() + ($5 || ' milliseconds')::interval)
       RETURNING id_fight, started_at, expires_at`,
      [idUser, idCharacter, origin, JSON.stringify(setup), String(Math.round(ttlMs))]
    );
    return r.rows[0];
  }

  static async lockFight(c, idUser, idFight) {
    const r = await c.query(`SELECT * FROM tb_mm_fight WHERE id_fight = $1 AND id_user = $2 FOR UPDATE`, [idFight, idUser]);
    return r.rows[0] || null;
  }

  /** Tickets abertos da pessoa (para fechar como abandono). */
  static async openFights(c, idUser) {
    const r = await c.query(`SELECT * FROM tb_mm_fight WHERE id_user = $1 AND closed_at IS NULL ORDER BY started_at FOR UPDATE`, [idUser]);
    return r.rows;
  }

  /** B5: soma uma luta no inventário de monstros (mig 365). */
  static async addTrophy(c, { idUser, kind, win, level }) {
    await c.query(
      `INSERT INTO tb_mm_monster_trophy (id_user, kind, wins, losses, best_level, first_win_at, last_at)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $3 > 0 THEN NOW() END, NOW())
       ON CONFLICT (id_user, kind) DO UPDATE SET
         wins = tb_mm_monster_trophy.wins + EXCLUDED.wins,
         losses = tb_mm_monster_trophy.losses + EXCLUDED.losses,
         best_level = GREATEST(tb_mm_monster_trophy.best_level, EXCLUDED.best_level),
         first_win_at = COALESCE(tb_mm_monster_trophy.first_win_at, EXCLUDED.first_win_at),
         last_at = NOW()`,
      [idUser, kind, win ? 1 : 0, win ? 0 : 1, win ? Math.max(0, Math.round(Number(level) || 0)) : 0]
    );
  }

  static async trophies(c, idUser) {
    const r = await c.query(
      `SELECT kind, wins, losses, best_level, first_win_at, last_at FROM tb_mm_monster_trophy WHERE id_user = $1`,
      [idUser]
    );
    return r.rows;
  }

  static async closeFight(c, idFight) {
    await c.query(`UPDATE tb_mm_fight SET closed_at = NOW() WHERE id_fight = $1 AND closed_at IS NULL`, [idFight]);
  }
}

module.exports = MeuMundoAdventureStorage;
module.exports.receiptOut = receiptOut;
