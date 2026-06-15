-- =============================================================================
-- Migration 155: XP da comunidade (acumulador) + snapshot de ranking
-- XP da comunidade = XP do líder (espelhado) + acumulador (+1 por membro/ciclo).
-- Snapshot por temporada para calcular crescimento (benchmark por nível) e perda
-- de posição (gatilho da votação de liderança — Slice 5). Idempotente.
-- =============================================================================

-- Acumulador próprio da comunidade (some +1 por membro a cada ciclo).
CREATE TABLE IF NOT EXISTS public.tb_community_xp_accumulator (
  id_community_profile UUID    PRIMARY KEY REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  accumulated_xp       NUMERIC NOT NULL DEFAULT 0,
  last_cycle_applied   INT     NOT NULL DEFAULT 0
);

-- Snapshot do placar de comunidades ao fim de cada temporada.
CREATE TABLE IF NOT EXISTS public.tb_community_ranking_snapshot (
  id            BIGSERIAL   PRIMARY KEY,
  season_number INT         NOT NULL,
  id_community  UUID        NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  xp_total      NUMERIC     NOT NULL DEFAULT 0,
  xp_level      INT         NOT NULL DEFAULT 0,
  position      INT         NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_comm_snapshot_season_community
  ON public.tb_community_ranking_snapshot (season_number, id_community);

CREATE INDEX IF NOT EXISTS idx_comm_snapshot_season
  ON public.tb_community_ranking_snapshot (season_number, position);
