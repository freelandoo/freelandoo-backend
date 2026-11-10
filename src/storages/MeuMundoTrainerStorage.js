// src/storages/MeuMundoTrainerStorage.js — MEU MUNDO 3D, lore v2 F2 (mig 437).
//
// Só SQL do nível do treinador (por conta). Quem chama já está dentro do
// `MeuMundoLifeService.withLife` (advisory lock da pessoa).

const COLS = `id_user, xp, level, gain_today, care_meals, train_hours,
  to_char(gain_day, 'YYYY-MM-DD') AS gain_day, to_char(care_day, 'YYYY-MM-DD') AS care_day`;

const blank = (idUser) => ({ id_user: idUser, xp: 0, level: 1, gain_day: null, gain_today: 0, care_day: null, care_meals: 0, train_hours: 0 });

class MeuMundoTrainerStorage {
  /** A linha do treinador (cria na 1ª vez), travada. */
  static async lock(c, idUser) {
    const r = await c.query(
      `INSERT INTO tb_mm_trainer (id_user) VALUES ($1)
       ON CONFLICT (id_user) DO UPDATE SET id_user = EXCLUDED.id_user
       RETURNING ${COLS}`,
      [idUser]
    );
    return r.rows[0];
  }

  /** Leitura sem travar (GET /adventure, telas). */
  static async get(c, idUser) {
    const r = await c.query(`SELECT ${COLS} FROM tb_mm_trainer WHERE id_user = $1`, [idUser]);
    return r.rows[0] || blank(idUser);
  }

  static async save(c, row) {
    await c.query(
      `UPDATE tb_mm_trainer SET xp = $2, level = $3, gain_day = $4, gain_today = $5,
              care_day = $6, care_meals = $7, train_hours = $8, updated_at = NOW()
        WHERE id_user = $1`,
      [row.id_user, row.xp, row.level, row.gain_day, row.gain_today, row.care_day, row.care_meals, row.train_hours]
    );
  }
}

module.exports = MeuMundoTrainerStorage;
