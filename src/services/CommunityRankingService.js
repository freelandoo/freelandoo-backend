// src/services/CommunityRankingService.js
// Ciclo de ranking das comunidades (roda no rollover de temporada):
//  1. aplica o acumulador (+1/membro) da temporada que encerrou,
//  2. recalcula o XP de todas as comunidades,
//  3. tira o snapshot do placar (com posições).
// E expõe getEligibleForVote: comunidades muito abaixo do crescimento médio do
// seu nível OU que perderam posição (gatilho da votação — Slice 5).

const CommunityXpService = require("./CommunityXpService");
const { createLogger } = require("../utils/logger");

const log = createLogger("CommunityRankingService");

// Fração do crescimento médio do nível abaixo da qual a comunidade é "muito
// abaixo da média" (ex.: cresceu menos da metade do que os pares cresceram).
const UNDERPERFORM_FRACTION = 0.5;

class CommunityRankingService {
  static async runCycle(db, season_number) {
    try {
      await CommunityXpService.applyCycleAccumulator(db, season_number);
      await CommunityXpService.recalcAll(db);
      await db.query(
        `INSERT INTO public.tb_community_ranking_snapshot
           (season_number, id_community, xp_total, xp_level, position)
         SELECT $1, id_profile, xp_total, xp_level,
                ROW_NUMBER() OVER (ORDER BY xp_total DESC, created_at ASC)
           FROM public.tb_profile
          WHERE is_community = TRUE AND deleted_at IS NULL
         ON CONFLICT (season_number, id_community) DO UPDATE
           SET xp_total = EXCLUDED.xp_total,
               xp_level = EXCLUDED.xp_level,
               position = EXCLUDED.position`,
        [season_number]
      );
      log.info("runCycle.ok", { season_number });
    } catch (err) {
      log.error("runCycle.fail", { season_number, error: err.message });
    }
  }

  // Comunidades elegíveis à votação no ciclo `season_number` (precisam de
  // histórico — snapshot anterior — para julgar crescimento/posição).
  static async getEligibleForVote(db, season_number) {
    const r = await db.query(
      `WITH cur AS (
         SELECT id_community, xp_total, xp_level, position
           FROM public.tb_community_ranking_snapshot
          WHERE season_number = $1
       ),
       prev AS (
         SELECT s.id_community, s.xp_total, s.position
           FROM public.tb_community_ranking_snapshot s
           JOIN (SELECT id_community, MAX(season_number) AS sn
                   FROM public.tb_community_ranking_snapshot
                  WHERE season_number < $1
                  GROUP BY id_community) mx
             ON mx.id_community = s.id_community AND mx.sn = s.season_number
       ),
       growth AS (
         SELECT c.id_community, c.xp_level,
                c.position AS cur_pos, p.position AS prev_pos,
                CASE WHEN p.xp_total IS NULL OR p.xp_total <= 0 THEN NULL
                     ELSE (c.xp_total - p.xp_total) / p.xp_total END AS g
           FROM cur c
           LEFT JOIN prev p ON p.id_community = c.id_community
       ),
       levelavg AS (
         SELECT xp_level, AVG(g) AS avg_g
           FROM growth WHERE g IS NOT NULL GROUP BY xp_level
       )
       SELECT gr.id_community
         FROM growth gr
         LEFT JOIN levelavg la ON la.xp_level = gr.xp_level
        WHERE gr.prev_pos IS NOT NULL
          AND (
               (gr.g IS NOT NULL AND la.avg_g IS NOT NULL AND la.avg_g > 0
                  AND gr.g < $2 * la.avg_g)
            OR (gr.cur_pos IS NOT NULL AND gr.prev_pos IS NOT NULL
                  AND gr.cur_pos > gr.prev_pos)
          )`,
      [season_number, UNDERPERFORM_FRACTION]
    );
    return r.rows.map((row) => row.id_community);
  }
}

module.exports = CommunityRankingService;
