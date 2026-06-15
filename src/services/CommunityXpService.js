// src/services/CommunityXpService.js
// XP da comunidade = XP do subperfil de maior XP do LÍDER (espelhado) +
// acumulador próprio (+1 por membro a cada ciclo de ranking). Trocar de líder
// re-baseia o espelho (o acumulador permanece).
//
// `db` pode ser o pool ou um client em transação. Sem runWithLogs aqui porque
// é chamado de dentro de outros fluxos (recalc de XP, rollover de temporada).

const XpStorage = require("../storages/XpStorage");
const { createLogger } = require("../utils/logger");

const log = createLogger("CommunityXpService");

class CommunityXpService {
  // Recalcula xp_total/xp_level de UMA comunidade.
  static async recalc(db, id_community) {
    const settings = await XpStorage.getSettings(db);
    if (!settings) return null;
    const base = Number(settings.base_xp_level_1);
    const mult = Number(settings.level_multiplier);

    const r = await db.query(
      `WITH leader AS (
         SELECT COALESCE(MAX(p.xp_total), 0)::numeric AS leader_xp
           FROM public.tb_profile c
           JOIN public.tb_community_member m
             ON m.id_community_profile = c.id_profile AND m.role = 'leader'
           JOIN public.tb_profile p
             ON p.id_user = m.id_user
            AND p.is_clan = FALSE AND p.is_community = FALSE AND p.deleted_at IS NULL
          WHERE c.id_profile = $1
       ),
       acc AS (
         SELECT COALESCE(accumulated_xp, 0)::numeric AS acc
           FROM public.tb_community_xp_accumulator
          WHERE id_community_profile = $1
       )
       SELECT COALESCE((SELECT leader_xp FROM leader), 0)
            + COALESCE((SELECT acc FROM acc), 0) AS total`,
      [id_community]
    );
    const total = Number(r.rows[0]?.total || 0);
    const level = XpStorage.levelFromXp(total, base, mult);

    await db.query(
      `UPDATE public.tb_profile
          SET xp_total = $2, xp_level = $3
        WHERE id_profile = $1 AND is_community = TRUE`,
      [id_community, total, level]
    );
    return { total, level };
  }

  // Recalcula todas as comunidades lideradas por um user (chamado quando o XP de
  // um subperfil do líder muda). Fire-and-forget safe.
  static async recalcForLeaderUser(db, id_user) {
    try {
      const r = await db.query(
        `SELECT id_profile FROM public.tb_profile
          WHERE id_leader_user = $1 AND is_community = TRUE AND deleted_at IS NULL`,
        [id_user]
      );
      for (const row of r.rows) {
        await this.recalc(db, row.id_profile);
      }
    } catch (err) {
      log.error("recalcForLeaderUser.fail", { id_user, error: err.message });
    }
  }

  // Acumulador do ciclo: +1 por membro. Guardado por last_cycle_applied para
  // não somar duas vezes a mesma temporada (idempotente por season_number).
  static async applyCycleAccumulator(db, season_number) {
    await db.query(
      `INSERT INTO public.tb_community_xp_accumulator
         (id_community_profile, accumulated_xp, last_cycle_applied)
       SELECT c.id_profile,
              (SELECT COUNT(*) FROM public.tb_community_member m
                WHERE m.id_community_profile = c.id_profile),
              $1
         FROM public.tb_profile c
        WHERE c.is_community = TRUE AND c.deleted_at IS NULL
       ON CONFLICT (id_community_profile) DO UPDATE
         SET accumulated_xp = public.tb_community_xp_accumulator.accumulated_xp +
               (SELECT COUNT(*) FROM public.tb_community_member m
                 WHERE m.id_community_profile = public.tb_community_xp_accumulator.id_community_profile),
             last_cycle_applied = $1
       WHERE public.tb_community_xp_accumulator.last_cycle_applied < $1`,
      [season_number]
    );
  }

  // Recalcula o XP de todas as comunidades.
  static async recalcAll(db) {
    const r = await db.query(
      `SELECT id_profile FROM public.tb_profile
        WHERE is_community = TRUE AND deleted_at IS NULL`
    );
    for (const row of r.rows) {
      await this.recalc(db, row.id_profile);
    }
  }
}

module.exports = CommunityXpService;
