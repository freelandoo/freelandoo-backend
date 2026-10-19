// src/storages/MeuMundoStorage.js — MEU MUNDO 3D (mig 291).
//
// Bairro, lote, casa e residência. Nada aqui toca saldo, Poléns ou
// patrimônio da Freelandoo: são dados do ambiente em desenvolvimento.

const { LOTS_PER_NEIGHBORHOOD, houseVariant } = require("../utils/meuMundoLayout");

const BODIES = ["normal", "slim", "fat", "strong"];

// Uma chave só para TODA alocação de residência. É ela que impede dois
// pedidos simultâneos de pegarem a mesma casa e — o caso mais sutil — de cada
// um criar o SEU bairro novo quando disputam a última vaga. A escala desta
// etapa (administradores) cabe folgada numa fila única; os índices únicos da
// mig 291 continuam valendo como última barreira.
const ALLOC_LOCK = "meu_mundo:alocacao";

const RESIDENCE_SELECT = `
  SELECT r.id_residence, r.id_user, r.started_at,
         h.id_house, h.variant, h.level, h.level_rev, l.lot_number,
         n.id_neighborhood, n.seq, n.name, n.layout
    FROM tb_mm_residence r
    JOIN tb_mm_house h ON h.id_house = r.id_house
    JOIN tb_mm_lot l ON l.id_lot = h.id_lot
    JOIN tb_mm_neighborhood n ON n.id_neighborhood = l.id_neighborhood
   WHERE r.status = 'active'`;

class MeuMundoStorage {
  static get BODIES() {
    return BODIES;
  }

  static async getActiveResidence(db, idUser) {
    const r = await db.query(`${RESIDENCE_SELECT} AND r.id_user = $1`, [idUser]);
    return r.rows[0] || null;
  }

  static async createNeighborhood(c) {
    const { rows } = await c.query(
      `SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM tb_mm_neighborhood`
    );
    const seq = Number(rows[0].next);
    const n = await c.query(
      `INSERT INTO tb_mm_neighborhood (seq, name) VALUES ($1, $2) RETURNING id_neighborhood, seq`,
      [seq, `Bairro ${String(seq).padStart(2, "0")}`]
    );
    const id = n.rows[0].id_neighborhood;
    for (let num = 1; num <= LOTS_PER_NEIGHBORHOOD; num++) {
      const lot = await c.query(
        `INSERT INTO tb_mm_lot (id_neighborhood, lot_number) VALUES ($1, $2) RETURNING id_lot`,
        [id, num]
      );
      await c.query(`INSERT INTO tb_mm_house (id_lot, level, variant) VALUES ($1, 1, $2)`, [
        lot.rows[0].id_lot,
        houseVariant(num),
      ]);
    }
    return id;
  }

  /**
   * Recupera a residência ativa ou aloca uma. Idempotente: repetir devolve a
   * mesma casa. Transacional: ou a residência inteira existe, ou nada mudou.
   * Devolve { residence, created }.
   */
  static async ensureResidence(pool, idUser) {
    const existing = await MeuMundoStorage.getActiveResidence(pool, idUser);
    if (existing) return { residence: existing, created: false };

    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [ALLOC_LOCK]);
      // Dentro do lock: outra requisição do mesmo usuário pode ter acabado de
      // alocar enquanto esta esperava.
      const again = await MeuMundoStorage.getActiveResidence(c, idUser);
      if (again) {
        await c.query("COMMIT");
        return { residence: again, created: false };
      }
      let free = await c.query(
        `SELECT h.id_house
           FROM tb_mm_house h
           JOIN tb_mm_lot l ON l.id_lot = h.id_lot
           JOIN tb_mm_neighborhood n ON n.id_neighborhood = l.id_neighborhood
           LEFT JOIN tb_mm_residence r ON r.id_house = h.id_house AND r.status = 'active'
          WHERE r.id_residence IS NULL
          ORDER BY n.seq, l.lot_number
          LIMIT 1`
      );
      if (!free.rows[0]) {
        const idNb = await MeuMundoStorage.createNeighborhood(c);
        free = await c.query(
          `SELECT h.id_house FROM tb_mm_house h JOIN tb_mm_lot l ON l.id_lot = h.id_lot
            WHERE l.id_neighborhood = $1 ORDER BY l.lot_number LIMIT 1`,
          [idNb]
        );
      }
      await c.query(`INSERT INTO tb_mm_residence (id_user, id_house) VALUES ($1, $2)`, [
        idUser,
        free.rows[0].id_house,
      ]);
      await c.query("COMMIT");
    } catch (err) {
      await c.query("ROLLBACK").catch(() => {});
      // Índice único (corrida que escapou do lock): a residência existe.
      if (err.code !== "23505") throw err;
    } finally {
      c.release();
    }
    const residence = await MeuMundoStorage.getActiveResidence(pool, idUser);
    return { residence, created: true };
  }

  /** Casas do bairro com o nome público do titular (nunca e-mail ou id). */
  static async listHouses(db, idNeighborhood, viewerId) {
    const r = await db.query(
      `SELECT l.lot_number AS number, h.variant, h.level, h.level_rev,
              u.username AS owner_name,
              (r.id_residence IS NOT NULL) AS taken,
              (r.id_user = $2) AS is_mine
         FROM tb_mm_lot l
         JOIN tb_mm_house h ON h.id_lot = l.id_lot
         LEFT JOIN tb_mm_residence r ON r.id_house = h.id_house AND r.status = 'active'
         LEFT JOIN tb_user u ON u.id_user = r.id_user
        WHERE l.id_neighborhood = $1
        ORDER BY l.lot_number`,
      [idNeighborhood, viewerId]
    );
    return r.rows.map((row) => ({
      number: row.number,
      variant: row.variant,
      level: row.level,
      levelRev: row.level_rev,
      ownerName: row.taken ? (row.owner_name || "morador").slice(0, 24) : null,
      isMine: row.is_mine === true,
    }));
  }

  /** Nível e revisão de cada casa do bairro (estado inicial da sala). */
  static async listHouseLevels(db, idNeighborhood) {
    const r = await db.query(
      `SELECT l.lot_number AS number, h.level, h.level_rev AS rev
         FROM tb_mm_lot l JOIN tb_mm_house h ON h.id_lot = l.id_lot
        WHERE l.id_neighborhood = $1`,
      [idNeighborhood]
    );
    return r.rows;
  }

  /**
   * Grava o nível da casa e incrementa a revisão na MESMA instrução (a
   * revisão é a ordem das escolhas confirmadas). Quem chama já conferiu que a
   * casa é do usuário e que o nível existe no catálogo.
   */
  static async setHouseLevel(db, idHouse, level) {
    const r = await db.query(
      `UPDATE tb_mm_house
          SET level = $2, level_rev = level_rev + 1, level_updated_at = NOW()
        WHERE id_house = $1
        RETURNING level, level_rev`,
      [idHouse, level]
    );
    return r.rows[0] || null;
  }

  static async countResidents(db, idNeighborhood) {
    const r = await db.query(
      `SELECT COUNT(*)::int AS n
         FROM tb_mm_residence r
         JOIN tb_mm_house h ON h.id_house = r.id_house
         JOIN tb_mm_lot l ON l.id_lot = h.id_lot
        WHERE r.status = 'active' AND l.id_neighborhood = $1`,
      [idNeighborhood]
    );
    return r.rows[0].n;
  }

  static async getBody(db, idUser) {
    const r = await db.query(`SELECT body FROM tb_mm_avatar_pref WHERE id_user = $1`, [idUser]);
    return r.rows[0]?.body || "normal";
  }

  static async setBody(db, idUser, body) {
    if (!BODIES.includes(body)) throw new Error("corpo inválido");
    await db.query(
      `INSERT INTO tb_mm_avatar_pref (id_user, body) VALUES ($1, $2)
       ON CONFLICT (id_user) DO UPDATE SET body = EXCLUDED.body, updated_at = NOW()`,
      [idUser, body]
    );
  }

  static async getPublicName(db, idUser) {
    const r = await db.query(`SELECT username FROM tb_user WHERE id_user = $1`, [idUser]);
    return (r.rows[0]?.username || "morador").slice(0, 24);
  }
}

module.exports = MeuMundoStorage;
