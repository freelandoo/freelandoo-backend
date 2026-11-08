// src/storages/MeuMundoStorage.js — MEU MUNDO 3D (mig 291).
//
// Bairro, lote, casa e residência. Nada aqui toca saldo, Poléns ou
// patrimônio da Freelandoo: são dados do ambiente em desenvolvimento.

const { LOTS_PER_NEIGHBORHOOD, houseVariant } = require("../utils/meuMundoLayout");
const { characterBody } = require("../utils/meuMundoSpecies");
const { lookFor } = require("../utils/meuMundoColors");
const { CLAN_BODIES, ARTIFACT, clanBody } = require("../utils/meuMundoClans");
// Monstros com corpo de avatar (2026-11-02: o Brutamontes), também skin de teste de
// administrador. Como os das classes, o corpo sai da skin e nunca é gravado em
// tb_mm_avatar_pref.body (setBody só grava a condição física) — fora do CHECK.
const MOB_BODIES = Object.freeze(["brutamontes"]);

// mm3d-30: "female" = skin "feminina"; "ekaterina" = skin "ekaterina".
// mm3d-50 (mig 313): os deuses — corpo = id da skin.
// mm3d-58: os corpos das classes (calculados, nunca gravados em avatar_pref).
const BODIES = ["normal", "slim", "fat", "strong", "sergio", "female", "ekaterina", "aurion", "morkhan", "kragor", "zephyra", "maru", "iris", "noctis", "aeryn", "ciborgue", "cavaleiro", "golem", "garras", ...CLAN_BODIES, ...MOB_BODIES];

// Uma chave só para TODA alocação de residência. É ela que impede dois
// pedidos simultâneos de pegarem a mesma casa e — o caso mais sutil — de cada
// um criar o SEU bairro novo quando disputam a última vaga. A escala desta
// etapa (administradores) cabe folgada numa fila única; os índices únicos da
// mig 291 continuam valendo como última barreira.
const ALLOC_LOCK = "meu_mundo:alocacao";
// B1: tb_profile.id_area existe? (T2, mig 336; null = ainda não conferido)
let hasProfileArea = null;

/**
 * B3: o personagem ATIVO de uma pessoa (o vivo; sem vivo, o último morto) — espécie,
 * sexo e fase da vida. Para LATERAL JOIN; `idUserExpr` é a coluna/parâmetro da pessoa.
 */
const ACTIVE_CHARACTER_SQL = (idUserExpr) => `
  SELECT ch.species, ch.sex, ch.growth->>'stage' AS stage
    FROM tb_mm_character ch
   WHERE ch.id_user = ${idUserExpr} AND ch.status IN ('alive', 'dead')
   ORDER BY (ch.status = 'alive') DESC, ch.generation DESC LIMIT 1`;

const RESIDENCE_SELECT = `
  SELECT r.id_residence, r.id_user, r.started_at,
         h.id_house, h.variant, h.level, h.level_rev, l.lot_number,
         n.id_neighborhood, n.seq, n.name, n.layout, n.clan
    FROM tb_mm_residence r
    JOIN tb_mm_house h ON h.id_house = r.id_house
    JOIN tb_mm_lot l ON l.id_lot = h.id_lot
    JOIN tb_mm_neighborhood n ON n.id_neighborhood = l.id_neighborhood
   WHERE r.status = 'active'`;

class MeuMundoStorage {
  static get BODIES() {
    return BODIES;
  }

  static get MOB_BODIES() {
    return MOB_BODIES;
  }

  static async getActiveResidence(db, idUser) {
    const r = await db.query(`${RESIDENCE_SELECT} AND r.id_user = $1`, [idUser]);
    return r.rows[0] || null;
  }

  /**
   * B1 (2026-11-08): a ÁREA do jogador (T2 — Região Imediata do IBGE, tb_profile.id_area do
   * perfil-conta, resolvida pela cidade). null = sem cidade/área. Tolerante: base sem a
   * coluna (testes antigos) = sem área.
   */
  static async areaOf(c, idUser) {
    // dentro de transação um erro abortaria tudo: confere a coluna antes (uma vez por processo)
    if (hasProfileArea === null) {
      const k = await c.query(
        `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tb_profile' AND column_name = 'id_area'`
      );
      hasProfileArea = k.rowCount > 0;
    }
    if (!hasProfileArea) return null;
    const r = await c.query(
      `SELECT id_area FROM tb_profile WHERE id_user = $1 AND is_user_account = TRUE AND deleted_at IS NULL LIMIT 1`,
      [idUser]
    );
    return r.rows[0] && r.rows[0].id_area != null ? Number(r.rows[0].id_area) : null;
  }

  static async createNeighborhood(c, clan = null, idArea = null) {
    const { rows } = await c.query(
      `SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM tb_mm_neighborhood`
    );
    const seq = Number(rows[0].next);
    const n = await c.query(
      `INSERT INTO tb_mm_neighborhood (seq, name, clan, id_area) VALUES ($1, $2, $3, $4) RETURNING id_neighborhood, seq`,
      [seq, `Bairro ${String(seq).padStart(2, "0")}`, clan, idArea]
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
   * Primeira casa livre num bairro DA CLASSE (mm3d-58) e DA ÁREA (B1, 2026-11-08: vizinho
   * perto de verdade). Com área: só bairro daquela área; sem vaga, nasce o próximo bairro
   * dessa classe e área. Sem área (sem cidade): qualquer bairro da classe com vaga, primeiro
   * os sem área. Chamar dentro da transação com ALLOC_LOCK.
   */
  static async freeHouseIn(c, clan, idArea = null) {
    let free = await c.query(
      `SELECT h.id_house
         FROM tb_mm_house h
         JOIN tb_mm_lot l ON l.id_lot = h.id_lot
         JOIN tb_mm_neighborhood n ON n.id_neighborhood = l.id_neighborhood
         LEFT JOIN tb_mm_residence r ON r.id_house = h.id_house AND r.status = 'active'
        WHERE r.id_residence IS NULL AND n.clan = $1
          AND ($2::int IS NULL OR n.id_area = $2::int)
        ORDER BY (n.id_area IS NULL) DESC, n.seq, l.lot_number
        LIMIT 1`,
      [clan, idArea]
    );
    if (!free.rows[0]) {
      const idNb = await MeuMundoStorage.createNeighborhood(c, clan, idArea);
      free = await c.query(
        `SELECT h.id_house FROM tb_mm_house h JOIN tb_mm_lot l ON l.id_lot = h.id_lot
          WHERE l.id_neighborhood = $1 ORDER BY l.lot_number LIMIT 1`,
        [idNb]
      );
    }
    return free.rows[0].id_house;
  }

  /**
   * Leva a residência para um bairro da classe (mm3d-58). Quem já mora em
   * bairro de outra classe (ou de antes das classes) muda levando o nível da
   * casa e a pintura do carro; a casa antiga fica livre. Os veículos são
   * guardados por bairro+lote: na casa nova eles começam na vaga.
   * Dentro da transação com ALLOC_LOCK. Devolve true se mudou.
   */
  static async moveToClan(c, idUser, clan) {
    const old = await MeuMundoStorage.getActiveResidence(c, idUser);
    if (old && old.clan === clan) return false;
    const idHouse = await MeuMundoStorage.freeHouseIn(c, clan, await MeuMundoStorage.areaOf(c, idUser));
    if (old) {
      await c.query(
        `UPDATE tb_mm_residence SET status = 'ended', ended_at = NOW(), end_reason = 'clan' WHERE id_residence = $1`,
        [old.id_residence]
      );
      await c.query(
        `UPDATE tb_mm_house n
            SET level = o.level, car_paint = o.car_paint, level_rev = n.level_rev + 1
           FROM tb_mm_house o
          WHERE n.id_house = $1 AND o.id_house = $2`,
        [idHouse, old.id_house]
      );
    }
    await c.query(`INSERT INTO tb_mm_residence (id_user, id_house) VALUES ($1, $2)`, [idUser, idHouse]);
    return true;
  }

  /**
   * Recupera a residência ativa ou aloca uma no bairro da classe. Idempotente:
   * repetir devolve a mesma casa. Transacional. Devolve { residence, created }.
   */
  static async ensureResidence(pool, idUser, clan) {
    const existing = await MeuMundoStorage.getActiveResidence(pool, idUser);
    if (existing && existing.clan === clan) return { residence: existing, created: false };

    const c = await pool.connect();
    let created = false;
    try {
      await c.query("BEGIN");
      await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [ALLOC_LOCK]);
      // Dentro do lock: outra requisição do mesmo usuário pode ter acabado de
      // alocar enquanto esta esperava.
      created = await MeuMundoStorage.moveToClan(c, idUser, clan);
      await c.query("COMMIT");
    } catch (err) {
      await c.query("ROLLBACK").catch(() => {});
      // Índice único (corrida que escapou do lock): a residência existe.
      if (err.code !== "23505") throw err;
    } finally {
      c.release();
    }
    const residence = await MeuMundoStorage.getActiveResidence(pool, idUser);
    return { residence, created };
  }

  // ── Classes (mm3d-58, mig 318) ───────────────────────────────────────────
  static async getClan(db, idUser) {
    const r = await db.query(
      `SELECT k.clan, k.sex, k.chosen_at, k.changed_at, k.changes,
              (SELECT COUNT(*)::int FROM tb_mm_artifact a
                WHERE a.id_user = $1 AND a.kind = $2 AND a.used_at IS NULL) AS artifacts
         FROM (SELECT $1::uuid AS id_user) u
         LEFT JOIN tb_mm_clan k ON k.id_user = u.id_user`,
      [idUser, ARTIFACT.KIND]
    );
    const row = r.rows[0];
    return {
      clan: row.clan || null,
      sex: row.sex || null,
      chosenAt: row.chosen_at,
      changedAt: row.changed_at,
      changes: row.changes || 0,
      artifacts: row.artifacts,
    };
  }

  /** Escolha da classe (uma vez). Muda a residência na mesma transação. */
  static async chooseClan(pool, idUser, clan, sex) {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [ALLOC_LOCK]);
      const had = await c.query(`SELECT clan FROM tb_mm_clan WHERE id_user = $1`, [idUser]);
      if (had.rows[0]) {
        await c.query("ROLLBACK");
        return { error: "Você já escolheu sua classe", statusCode: 409, code: "clan_chosen" };
      }
      await c.query(`INSERT INTO tb_mm_clan (id_user, clan, sex) VALUES ($1, $2, $3)`, [idUser, clan, sex]);
      await MeuMundoStorage.moveToClan(c, idUser, clan);
      // B3: o personagem que ainda não tinha espécie vira a da classe escolhida.
      await c.query(`UPDATE tb_mm_character SET species = $2, sex = $3 WHERE id_user = $1 AND species IS NULL`, [idUser, clan, sex]);
      await c.query("COMMIT");
      return { ok: true };
    } catch (err) {
      await c.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      c.release();
    }
  }

  /**
   * Troca de classe pelo ARTEFATO (consumido aqui): recarga de 30 dias desde
   * a última troca; muda a residência na mesma transação.
   */
  static async changeClan(pool, idUser, clan) {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [ALLOC_LOCK]);
      const row = (await c.query(`SELECT clan, changed_at FROM tb_mm_clan WHERE id_user = $1 FOR UPDATE`, [idUser])).rows[0];
      const fail = async (error, statusCode, code) => {
        await c.query("ROLLBACK");
        return { error, statusCode, code };
      };
      if (!row) return await fail("Escolha sua classe primeiro", 409, "needs_clan");
      if (row.clan === clan) return await fail("Você já é dessa classe", 400, "same_clan");
      const wait = row.changed_at ? new Date(row.changed_at).getTime() + ARTIFACT.COOLDOWN_DAYS * 86400000 - Date.now() : 0;
      if (wait > 0) return await fail("O artefato ainda está recarregando", 409, "clan_cooldown");
      const art = (
        await c.query(
          `SELECT id_artifact FROM tb_mm_artifact
            WHERE id_user = $1 AND kind = $2 AND used_at IS NULL
            ORDER BY acquired_at LIMIT 1 FOR UPDATE`,
          [idUser, ARTIFACT.KIND]
        )
      ).rows[0];
      if (!art) return await fail("Você precisa do artefato de troca de classe", 402, "no_artifact");
      await c.query(`UPDATE tb_mm_artifact SET used_at = NOW() WHERE id_artifact = $1`, [art.id_artifact]);
      await c.query(
        `UPDATE tb_mm_clan SET clan = $2, changed_at = NOW(), changes = changes + 1 WHERE id_user = $1`,
        [idUser, clan]
      );
      await MeuMundoStorage.moveToClan(c, idUser, clan);
      await MeuMundoStorage.setSkin(c, idUser, "standard");
      await c.query("COMMIT");
      return { ok: true };
    } catch (err) {
      await c.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      c.release();
    }
  }

  /** Dá um artefato (origem: compra, queda de monstro, teste de admin…). */
  static async grantArtifact(db, idUser, source) {
    await db.query(`INSERT INTO tb_mm_artifact (id_user, kind, source) VALUES ($1, $2, $3)`, [idUser, ARTIFACT.KIND, source]);
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

  /**
   * Corpo que a sala desenha (B3): o do personagem ATIVO — a espécie dele (com o sexo e a
   * fase da vida); sem espécie, o corpo da classe (mm3d-58) ou a condição física. O
   * vestuário (skins, mig 300) saiu do jogo: as skins viraram espécies de personagem.
   */
  static async getBody(db, idUser) {
    const r = await db.query(
      `SELECT p.body, k.clan, k.sex AS clan_sex, a.species, a.sex, a.stage
         FROM (SELECT $1::uuid AS id_user) u
         LEFT JOIN tb_mm_avatar_pref p ON p.id_user = u.id_user
         LEFT JOIN tb_mm_clan k ON k.id_user = u.id_user
         LEFT JOIN LATERAL (${ACTIVE_CHARACTER_SQL("u.id_user")}) a ON TRUE`,
      [idUser]
    );
    const row = r.rows[0] || {};
    return characterBody({ species: row.species, sex: row.sex, stage: row.stage, clan: row.clan, clanSex: row.clan_sex, condition: row.body || "normal" });
  }

  /** Corpo da classe agora (classe + sexo + fase do personagem ativo); null sem classe. */
  static async getClanBody(db, idUser) {
    const r = await db.query(
      `SELECT k.clan, k.sex, a.stage
         FROM tb_mm_clan k
         LEFT JOIN LATERAL (${ACTIVE_CHARACTER_SQL("k.id_user")}) a ON TRUE
        WHERE k.id_user = $1`,
      [idUser]
    );
    const row = r.rows[0];
    return row ? clanBody(row.clan, row.sex, row.stage) : null;
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
module.exports.ACTIVE_CHARACTER_SQL = ACTIVE_CHARACTER_SQL;
