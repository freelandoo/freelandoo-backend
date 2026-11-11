/**
 * Domingo na estátua do Meu Mundo (lore v2 N3, mig 442). SQL puro.
 */
const St = require("../utils/meuMundoStatue");

const raceRow = (r) =>
  r
    ? {
        week: r.week instanceof Date ? r.week.toISOString().slice(0, 10) : String(r.week).slice(0, 10),
        clan: r.clan,
        deliveredMl: Number(r.delivered_ml),
        goalMl: Number(r.goal_ml),
        active: Number(r.active),
        donors: Number(r.donors),
        fullAt: r.full_at ? new Date(r.full_at).toISOString() : null,
      }
    : null;

const deliveryRow = (r) => ({
  id: Number(r.id_delivery),
  week: r.week instanceof Date ? r.week.toISOString().slice(0, 10) : String(r.week).slice(0, 10),
  clan: r.clan,
  place: r.place,
  ml: Number(r.ml),
  at: new Date(r.created_at).toISOString(),
});

class MeuMundoStatueStorage {
  static async config(db) {
    const r = await db.query(`SELECT base_ml, per_active_ml, updated_at FROM tb_mm_statue_config WHERE id = 1`);
    const x = r.rows[0];
    if (!x) return { ...St.DEFAULT_CONFIG, updatedAt: null };
    return { baseMl: Number(x.base_ml), perActiveMl: Number(x.per_active_ml), updatedAt: x.updated_at ? new Date(x.updated_at).toISOString() : null };
  }

  static async saveConfig(db, { baseMl, perActiveMl }, idUser) {
    await db.query(
      `INSERT INTO tb_mm_statue_config (id, base_ml, per_active_ml, updated_at, updated_by) VALUES (1, $1, $2, NOW(), $3)
       ON CONFLICT (id) DO UPDATE SET base_ml = EXCLUDED.base_ml, per_active_ml = EXCLUDED.per_active_ml, updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
      [baseMl, perActiveMl, idUser || null]
    );
  }

  /** Jogadores ATIVOS de cada povo: quem ganhou néctar na semana `week` (fechada). → { raposa, vampiro } */
  static async activeByClan(db, week) {
    const r = await db.query(
      `SELECT k.clan, COUNT(DISTINCT a.id_user)::int AS n
         FROM tb_mm_nectar_award a JOIN tb_mm_clan k ON k.id_user = a.id_user
        WHERE a.week = $1 AND k.clan IN ('raposa', 'vampiro')
        GROUP BY k.clan`,
      [week]
    );
    const out = { raposa: 0, vampiro: 0 };
    for (const x of r.rows) out[x.clan] = Number(x.n);
    return out;
  }

  /** As linhas da corrida de um domingo (só as que já existem). */
  static async races(db, week) {
    const r = await db.query(`SELECT * FROM tb_mm_statue_week WHERE week = $1`, [week]);
    return r.rows.map(raceRow);
  }

  /** Abre a linha da corrida (meta congelada aqui) e trava. */
  static async lockRace(c, { week, clan, goalMl, active }) {
    await c.query(
      `INSERT INTO tb_mm_statue_week (week, clan, goal_ml, active) VALUES ($1, $2, $3, $4)
       ON CONFLICT (week, clan) DO NOTHING`,
      [week, clan, goalMl, active]
    );
    return raceRow((await c.query(`SELECT * FROM tb_mm_statue_week WHERE week = $1 AND clan = $2 FOR UPDATE`, [week, clan])).rows[0]);
  }

  static async addToRace(c, { week, clan, ml, newDonor, now }) {
    const r = await c.query(
      `UPDATE tb_mm_statue_week
          SET delivered_ml = delivered_ml + $3,
              donors = donors + $4,
              full_at = CASE WHEN full_at IS NULL AND delivered_ml + $3 >= goal_ml THEN $5::timestamptz ELSE full_at END,
              updated_at = NOW()
        WHERE week = $1 AND clan = $2
        RETURNING *`,
      [week, clan, ml, newDonor ? 1 : 0, new Date(now).toISOString()]
    );
    return raceRow(r.rows[0]);
  }

  /** Admin mudou a meta: recalcula as linhas ABERTAS (ainda não cheias) do domingo. */
  static async regoal(c, week, cfg, now) {
    const r = await c.query(`SELECT * FROM tb_mm_statue_week WHERE week = $1 AND full_at IS NULL FOR UPDATE`, [week]);
    for (const x of r.rows) {
      const goal = St.goalFor(x.active, cfg);
      await c.query(
        `UPDATE tb_mm_statue_week SET goal_ml = $3,
                full_at = CASE WHEN delivered_ml >= $3 THEN $4::timestamptz ELSE NULL END, updated_at = NOW()
          WHERE week = $1 AND clan = $2`,
        [week, x.clan, goal, new Date(now).toISOString()]
      );
    }
  }

  static async findDelivery(c, idUser, key) {
    const r = await c.query(`SELECT * FROM tb_mm_nectar_delivery WHERE id_user = $1 AND request_key = $2`, [idUser, key]);
    return r.rows[0] ? deliveryRow(r.rows[0]) : null;
  }

  /** A pessoa já entregou neste domingo? (para contar doadores) */
  static async deliveredThisWeek(c, idUser, week) {
    const r = await c.query(`SELECT COALESCE(SUM(ml), 0)::bigint AS ml FROM tb_mm_nectar_delivery WHERE id_user = $1 AND week = $2`, [idUser, week]);
    return Number(r.rows[0].ml);
  }

  static async insertDelivery(c, { idUser, key, week, clan, place, ml, now }) {
    const r = await c.query(
      `INSERT INTO tb_mm_nectar_delivery (id_user, request_key, week, clan, place, ml, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [idUser, key, week, clan, place, ml, new Date(now).toISOString()]
    );
    return deliveryRow(r.rows[0]);
  }

  /** Trava a carteira e devolve o "para entregar" (mL). */
  static async lockWallet(c, idUser) {
    const r = await c.query(`SELECT pending_ml FROM tb_mm_nectar_wallet WHERE id_user = $1 FOR UPDATE`, [idUser]);
    return r.rows[0] ? Number(r.rows[0].pending_ml) : 0;
  }

  static async debit(c, idUser, ml) {
    const r = await c.query(
      `UPDATE tb_mm_nectar_wallet SET pending_ml = pending_ml - $2, updated_at = NOW() WHERE id_user = $1 AND pending_ml >= $2 RETURNING pending_ml`,
      [idUser, ml]
    );
    return r.rows[0] ? Number(r.rows[0].pending_ml) : null;
  }

  /** Total entregue por uma conta desde `since` (o check nectar:N), em mL. */
  static async deliveredSince(db, idUser, since) {
    const r = await db.query(`SELECT COALESCE(SUM(ml), 0)::bigint AS ml FROM tb_mm_nectar_delivery WHERE id_user = $1 AND created_at >= $2`, [idUser, since]);
    return Number(r.rows[0].ml);
  }
}

module.exports = MeuMundoStatueStorage;
