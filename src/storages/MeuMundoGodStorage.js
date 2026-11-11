/**
 * O deus solto do Meu Mundo (lore v2 N4, mig 447). SQL puro.
 */
const G = require("../utils/meuMundoGodHunt");

const huntRow = (r) =>
  r
    ? {
        id: Number(r.id_hunt),
        week: r.week ? (r.week instanceof Date ? r.week.toISOString().slice(0, 10) : String(r.week).slice(0, 10)) : null,
        clan: r.clan,
        god: r.god,
        prey: G.godOf(r.god) ? G.godOf(r.god).prey : null,
        source: r.source,
        looseAt: new Date(r.loose_at).toISOString(),
        defeatedAt: r.defeated_at ? new Date(r.defeated_at).toISOString() : null,
        winner: r.winner_name !== undefined ? r.winner_name || null : undefined,
      }
    : null;

class MeuMundoGodStorage {
  /**
   * Toda estátua cheia vira uma caçada (uma por domingo × povo), solta no fim do
   * domingo. Idempotente (ON CONFLICT): pode rodar a cada leitura.
   */
  static async syncFromStatues(db) {
    const rows = (await db.query(`SELECT week, clan FROM tb_mm_statue_week WHERE full_at IS NOT NULL`)).rows;
    for (const r of rows) {
      const week = r.week instanceof Date ? r.week.toISOString().slice(0, 10) : String(r.week).slice(0, 10);
      const g = G.godOfClan(r.clan);
      if (!g) continue;
      await db.query(
        `INSERT INTO tb_mm_god_hunt (week, clan, god, source, loose_at) VALUES ($1, $2, $3, 'statue', $4)
         ON CONFLICT (week, clan) WHERE week IS NOT NULL DO NOTHING`,
        [week, r.clan, g.id, new Date(G.looseAtFor(week)).toISOString()]
      );
    }
  }

  /** Caçadas soltas AGORA (uma por deus: a mais antiga aberta). */
  static async loose(db, now) {
    const r = await db.query(
      `SELECT DISTINCT ON (god) * FROM tb_mm_god_hunt
        WHERE defeated_at IS NULL AND loose_at <= $1
        ORDER BY god, loose_at, id_hunt`,
      [new Date(now).toISOString()]
    );
    return r.rows.map(huntRow);
  }

  /** Próximas (estátua cheia, solta depois). */
  static async upcoming(db, now) {
    const r = await db.query(
      `SELECT DISTINCT ON (god) * FROM tb_mm_god_hunt WHERE defeated_at IS NULL AND loose_at > $1 ORDER BY god, loose_at, id_hunt`,
      [new Date(now).toISOString()]
    );
    return r.rows.map(huntRow);
  }

  /** As últimas quedas (quem venceu cada deus). */
  static async fallen(db, limit = 4) {
    const r = await db.query(
      `SELECT h.*, u.username AS winner_name FROM tb_mm_god_hunt h LEFT JOIN tb_user u ON u.id_user = h.id_user
        WHERE h.defeated_at IS NOT NULL ORDER BY h.defeated_at DESC LIMIT $1`,
      [limit]
    );
    return r.rows.map(huntRow);
  }

  /** Marca o aviso de "solto" (uma vez por caçada; devolve só as que este processo marcou). */
  static async announce(db, ids, now) {
    if (!ids.length) return [];
    const r = await db.query(
      `UPDATE tb_mm_god_hunt SET announced_at = $2 WHERE id_hunt = ANY($1::bigint[]) AND announced_at IS NULL RETURNING *`,
      [ids, new Date(now).toISOString()]
    );
    return r.rows.map(huntRow);
  }

  /**
   * A vitória conferida derruba o deus (dentro da transação do recibo): fecha TODAS as
   * caçadas abertas e já soltas dele (o deus é um só). Já caído = []. Trava as linhas.
   */
  static async defeat(c, { god, idUser, idFight, now }) {
    const at = new Date(now).toISOString();
    const r = await c.query(
      `UPDATE tb_mm_god_hunt SET defeated_at = $3, id_user = $4,
              id_fight = CASE WHEN id_hunt = (SELECT MIN(id_hunt) FROM tb_mm_god_hunt WHERE god = $1 AND defeated_at IS NULL AND loose_at <= $3) THEN $2::uuid END
        WHERE god = $1 AND defeated_at IS NULL AND loose_at <= $3
        RETURNING *`,
      [god, idFight, at, idUser]
    );
    return r.rows.map(huntRow);
  }

  /** Admin: solta o deus de um povo agora (para conferir). Já solto = devolve o de pé. */
  static async adminRelease(c, clan, now) {
    const g = G.godOfClan(clan);
    await c.query(`SELECT pg_advisory_xact_lock(44701, $1)`, [clan === "raposa" ? 1 : 2]);
    const open = (await c.query(`SELECT * FROM tb_mm_god_hunt WHERE god = $1 AND defeated_at IS NULL AND loose_at <= $2 LIMIT 1`, [g.id, new Date(now).toISOString()])).rows[0];
    if (open) return { hunt: huntRow(open), fresh: false };
    const r = await c.query(`INSERT INTO tb_mm_god_hunt (week, clan, god, source, loose_at) VALUES (NULL, $1, $2, 'admin', $3) RETURNING *`, [clan, g.id, new Date(now).toISOString()]);
    return { hunt: huntRow(r.rows[0]), fresh: true };
  }
}

module.exports = MeuMundoGodStorage;
