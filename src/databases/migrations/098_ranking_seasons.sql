-- =============================================================================
-- Migration 098: Temporadas do ranking + Hall da Fama
-- =============================================================================
-- O ranking passa a ser por TEMPORADA: zera a cada `period_days` dias.
-- A pontuação continua sendo a soma dos mesmos subprofile_xp_events do XP —
-- só que filtrada pela temporada corrente (created_at >= season_started_at).
-- XP total e nível continuam permanentes (não são afetados por esta migration).

-- ─────────────────────────────────────────────────────────────────────────────
-- Estado da temporada corrente no ranking_config (linha única id = 1)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.ranking_config
  ADD COLUMN IF NOT EXISTS season_number     INT         NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS season_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ─────────────────────────────────────────────────────────────────────────────
-- Hall da Fama: snapshot do placar final de cada temporada encerrada.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ranking_season_archive (
  id                  BIGSERIAL    PRIMARY KEY,
  season_number       INT          NOT NULL,
  id_profile          UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  display_name        VARCHAR(255) NULL,
  avatar_url          TEXT         NULL,
  username            VARCHAR(255) NULL,
  is_clan             BOOLEAN      NOT NULL DEFAULT FALSE,
  total_points        NUMERIC      NOT NULL DEFAULT 0,
  position_general    INT          NULL,
  position_machine    INT          NULL,
  position_city       INT          NULL,
  position_profession INT          NULL,
  season_started_at   TIMESTAMPTZ  NULL,
  season_ended_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  archived_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Mesmo perfil só aparece uma vez por temporada arquivada.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ranking_season_archive_profile
  ON public.ranking_season_archive (season_number, id_profile);

CREATE INDEX IF NOT EXISTS idx_ranking_season_archive_season
  ON public.ranking_season_archive (season_number, position_general);

COMMENT ON TABLE public.ranking_season_archive IS
  'Hall da Fama: placar final de cada temporada encerrada do ranking.';
COMMENT ON COLUMN public.ranking_config.season_number IS
  'Número da temporada corrente do ranking (incrementa a cada reset).';
COMMENT ON COLUMN public.ranking_config.season_started_at IS
  'Início da temporada corrente. O ranking soma eventos de XP a partir desta data.';
