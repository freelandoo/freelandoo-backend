// src/storages/MeuMundoGachaStorage.js — Convocações (gacha-v1, mig 469): contador de garantia por banner.
// Escrita só dentro do withLife (o lock da vida serializa a pessoa); a linha ainda é travada com FOR UPDATE.
"use strict";

const { receiptOut } = require("./MeuMundoAdventureStorage");

const stateOut = (r) => ({
  banner: r.banner,
  sinceRare: r.since_rare,
  sinceTop: r.since_top,
  guaranteed: r.guaranteed,
  target: r.target,
  pulls: r.pulls,
});

class MeuMundoGachaStorage {
  /** Os contadores de todos os banners da pessoa (leitura). */
  static async states(c, idUser) {
    const r = await c.query(`SELECT * FROM tb_mm_gacha_state WHERE id_user = $1`, [idUser]);
    return Object.fromEntries(r.rows.map((x) => [x.banner, stateOut(x)]));
  }

  /** Trava (e cria vazia, se faltar) a linha do banner. */
  static async lockState(c, idUser, banner) {
    await c.query(`INSERT INTO tb_mm_gacha_state (id_user, banner) VALUES ($1, $2) ON CONFLICT (id_user, banner) DO NOTHING`, [idUser, banner]);
    const r = await c.query(`SELECT * FROM tb_mm_gacha_state WHERE id_user = $1 AND banner = $2 FOR UPDATE`, [idUser, banner]);
    return stateOut(r.rows[0]);
  }

  static async saveState(c, idUser, banner, st, target, added) {
    await c.query(
      `UPDATE tb_mm_gacha_state SET since_rare = $3, since_top = $4, guaranteed = $5, target = $6, pulls = pulls + $7, updated_at = NOW()
       WHERE id_user = $1 AND banner = $2`,
      [idUser, banner, st.sinceRare, st.sinceTop, !!st.guaranteed, target, added]
    );
  }

  /** Histórico: os recibos dos giros, do mais novo ao mais velho; `before` = cursor (ISO do último visto). */
  static async history(c, idUser, { before = null, limit = 20 } = {}) {
    const r = await c.query(
      `SELECT * FROM tb_mm_receipt WHERE id_user = $1 AND source = 'gacha_pull' AND ($2::timestamptz IS NULL OR created_at < $2::timestamptz)
       ORDER BY created_at DESC LIMIT $3`,
      [idUser, before, limit]
    );
    return r.rows.map(receiptOut);
  }
}

module.exports = MeuMundoGachaStorage;
