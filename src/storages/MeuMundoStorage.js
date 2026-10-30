// src/storages/MeuMundoStorage.js — MEU MUNDO 3D (mig 291).
//
// Bairro, lote, casa e residência. Nada aqui toca saldo, Poléns ou
// patrimônio da Freelandoo: são dados do ambiente em desenvolvimento.

const { LOTS_PER_NEIGHBORHOOD, houseVariant } = require("../utils/meuMundoLayout");
const { avatarBody } = require("../utils/meuMundoSkins");
const { lookFor } = require("../utils/meuMundoColors");

// mm3d-30: "female" = skin "feminina"; "ekaterina" = skin "ekaterina".
// mm3d-50 (mig 313): os deuses — corpo = id da skin.
const BODIES = ["normal", "slim", "fat", "strong", "sergio", "female", "ekaterina", "aurion", "morkhan", "kragor", "zephyra", "maru", "iris", "noctis", "aeryn"];

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
      `SELECT l.lot_number AS number, h.level, h.level_rev AS rev, h.car_paint AS paint
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

  // ── Vendedor (mm3d-37e, mig 309) ──────────────────────────────────────────
  /** Cor do carro da casa (null = vermelho de fábrica). */
  static async setCarPaint(db, idHouse, paint) {
    const r = await db.query(`UPDATE tb_mm_house SET car_paint = $2 WHERE id_house = $1 RETURNING car_paint`, [idHouse, paint]);
    return r.rows[0] || null;
  }

  static async carPaintOf(db, idHouse) {
    const r = await db.query(`SELECT level, car_paint FROM tb_mm_house WHERE id_house = $1`, [idHouse]);
    return r.rows[0] || null;
  }

  /** Cores do carro que a pessoa já comprou. */
  static async ownedPaints(db, idUser) {
    const r = await db.query(`SELECT paint FROM tb_mm_car_paint_owned WHERE id_user = $1`, [idUser]);
    return r.rows.map((x) => x.paint);
  }

  /** Grava a compra; false = já tinha (nada a cobrar). */
  static async addOwnedPaint(db, idUser, paint, price) {
    const r = await db.query(
      `INSERT INTO tb_mm_car_paint_owned (id_user, paint, price) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [idUser, paint, price]
    );
    return r.rowCount > 0;
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

  /** Corpo que a sala desenha: a skin vestida (mig 300) ou a condição física. */
  static async getBody(db, idUser) {
    const r = await db.query(`SELECT body, skin FROM tb_mm_avatar_pref WHERE id_user = $1`, [idUser]);
    return avatarBody(r.rows[0]?.body || "normal", r.rows[0]?.skin);
  }

  /** Cores da skin vestida (mm3d-36, mig 304): "" para skin sem cores. */
  static async getLook(db, idUser) {
    const r = await db.query(`SELECT skin, colors FROM tb_mm_avatar_pref WHERE id_user = $1`, [idUser]);
    return lookFor(r.rows[0]?.colors, r.rows[0]?.skin || "standard");
  }

  /** Cores de cada skin colorível (mm3d-36), para o guarda-roupa. */
  static async getColors(db, idUser) {
    const r = await db.query(`SELECT colors FROM tb_mm_avatar_pref WHERE id_user = $1`, [idUser]);
    return r.rows[0]?.colors || {};
  }

  /** Grava as cores de uma skin (código já validado por quem chama). */
  static async setColors(db, idUser, skin, look) {
    await db.query(
      `INSERT INTO tb_mm_avatar_pref (id_user, colors) VALUES ($1, jsonb_build_object($2::text, $3::text))
       ON CONFLICT (id_user) DO UPDATE SET colors = tb_mm_avatar_pref.colors || jsonb_build_object($2::text, $3::text), updated_at = NOW()`,
      [idUser, skin, look]
    );
  }

  /** Vestuário (mig 300): skin vestida + compradas. */
  static async getWardrobe(db, idUser) {
    const [pref, owned] = await Promise.all([
      db.query(`SELECT body, skin FROM tb_mm_avatar_pref WHERE id_user = $1`, [idUser]),
      db.query(`SELECT skin FROM tb_mm_skin_owned WHERE id_user = $1`, [idUser]),
    ]);
    return {
      condition: pref.rows[0]?.body || "normal",
      equipped: pref.rows[0]?.skin || "standard",
      owned: owned.rows.map((r) => r.skin),
    };
  }

  /** Administrador adquire skin de graça (mesma regra do roleMiddleware). */
  static async isAdmin(db, idUser) {
    const r = await db.query(
      `SELECT 1 FROM tb_user_role ur JOIN tb_role ro ON ro.id_role = ur.id_role
        WHERE ur.id_user = $1 AND ur.is_active = TRUE AND ro.is_active = TRUE AND ro.desc_role = 'Administrator'
        LIMIT 1`,
      [idUser]
    );
    return r.rows.length > 0;
  }

  /** Compra (idempotente: já tinha = false, nada muda). */
  static async addSkin(db, idUser, skin, price) {
    const r = await db.query(
      `INSERT INTO tb_mm_skin_owned (id_user, skin, price) VALUES ($1, $2, $3)
       ON CONFLICT (id_user, skin) DO NOTHING`,
      [idUser, skin, price]
    );
    return r.rowCount > 0;
  }

  static async setSkin(db, idUser, skin) {
    await db.query(
      `INSERT INTO tb_mm_avatar_pref (id_user, skin) VALUES ($1, $2)
       ON CONFLICT (id_user) DO UPDATE SET skin = EXCLUDED.skin, updated_at = NOW()
       WHERE tb_mm_avatar_pref.skin IS DISTINCT FROM EXCLUDED.skin`,
      [idUser, skin]
    );
  }

  static async setBody(db, idUser, body) {
    if (!BODIES.includes(body)) throw new Error("corpo inválido");
    await db.query(
      `INSERT INTO tb_mm_avatar_pref (id_user, body) VALUES ($1, $2)
       ON CONFLICT (id_user) DO UPDATE SET body = EXCLUDED.body, updated_at = NOW()
       WHERE tb_mm_avatar_pref.body IS DISTINCT FROM EXCLUDED.body`,
      [idUser, body]
    );
  }

  /**
   * Uma casa com o lote, o bairro e o TITULAR ativo (id interno só para o
   * servidor conferir permissão — nunca vai para a rede).
   */
  static async getHouse(db, idHouse) {
    const r = await db.query(
      `SELECT h.id_house, h.level, h.level_rev, h.variant, l.lot_number,
              n.id_neighborhood, n.seq, n.name AS neighborhood_name,
              r.id_user AS owner_id, u.username AS owner_name
         FROM tb_mm_house h
         JOIN tb_mm_lot l ON l.id_lot = h.id_lot
         JOIN tb_mm_neighborhood n ON n.id_neighborhood = l.id_neighborhood
         LEFT JOIN tb_mm_residence r ON r.id_house = h.id_house AND r.status = 'active'
         LEFT JOIN tb_user u ON u.id_user = r.id_user
        WHERE h.id_house = $1`,
      [idHouse]
    );
    return r.rows[0] || null;
  }

  static async getHouseByLot(db, idNeighborhood, lotNumber) {
    const r = await db.query(
      `SELECT h.id_house FROM tb_mm_house h JOIN tb_mm_lot l ON l.id_lot = h.id_lot
        WHERE l.id_neighborhood = $1 AND l.lot_number = $2`,
      [idNeighborhood, lotNumber]
    );
    return r.rows[0] ? MeuMundoStorage.getHouse(db, r.rows[0].id_house) : null;
  }

  /** Usuário pelo nome público exato (convite). Só o id, para o servidor. */
  static async findUserByUsername(db, username) {
    const r = await db.query(`SELECT id_user, username FROM tb_user WHERE username = $1 LIMIT 1`, [username]);
    return r.rows[0] || null;
  }

  static async getPublicName(db, idUser) {
    const r = await db.query(`SELECT username FROM tb_user WHERE id_user = $1`, [idUser]);
    return (r.rows[0]?.username || "morador").slice(0, 24);
  }
}

module.exports = MeuMundoStorage;
