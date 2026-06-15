-- =============================================================================
-- Migration 159: Metas coletivas + Mural do líder da Comunidade
-- - tb_community_goal: 1 meta ativa por comunidade (métrica xp|posts|members,
--   alvo + baseline capturado na criação; progresso = valor atual - baseline).
-- - tb_community_announcement: recados/avisos do líder (mural), com fixados.
-- Idempotente.
-- =============================================================================

-- ── Metas coletivas ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_community_goal (
  id                   BIGSERIAL    PRIMARY KEY,
  id_community_profile UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  title                TEXT         NOT NULL,
  metric               VARCHAR(20)  NOT NULL DEFAULT 'xp',  -- 'xp' | 'posts' | 'members'
  target_value         NUMERIC      NOT NULL,
  baseline_value       NUMERIC      NOT NULL DEFAULT 0,
  ends_at              TIMESTAMPTZ  NULL,
  created_by_user      UUID         NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  is_active            BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- No máximo 1 meta ativa por comunidade.
CREATE UNIQUE INDEX IF NOT EXISTS ux_community_goal_active
  ON public.tb_community_goal (id_community_profile)
  WHERE is_active = TRUE;

-- ── Mural do líder (recados/avisos) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_community_announcement (
  id                   BIGSERIAL    PRIMARY KEY,
  id_community_profile UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  body                 TEXT         NOT NULL,
  is_pinned            BOOLEAN      NOT NULL DEFAULT FALSE,
  created_by_user      UUID         NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_community_announcement_comm
  ON public.tb_community_announcement (id_community_profile, is_pinned DESC, created_at DESC);
