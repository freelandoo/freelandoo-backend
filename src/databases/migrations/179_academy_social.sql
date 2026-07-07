-- =============================================================================
-- Migration 179: Fitness & Academias — Fase 4 (social da academia)
-- Posts (texto/imagem/vídeo) no feed da academia, metas mensais configuráveis
-- pelo dono (posts / compartilhamentos / FREQUÊNCIA pela catraca) e base do
-- ranking de membros. Tabelas próprias — não toca comunidade. Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_academy_post (
  id_post       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_academy    UUID         NOT NULL REFERENCES public.tb_academy(id_academy) ON DELETE CASCADE,
  id_user       UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  caption       TEXT         NULL,
  media_url     TEXT         NULL,
  thumbnail_url TEXT         NULL,
  media_kind    VARCHAR(8)   NULL CHECK (media_kind IN ('image','video')),
  share_count   INT          NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ  NULL
);

CREATE INDEX IF NOT EXISTS idx_academy_post_feed
  ON public.tb_academy_post (id_academy, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_academy_post_author
  ON public.tb_academy_post (id_user, created_at DESC);

-- Metas mensais da academia (1 linha por academia; dono edita).
CREATE TABLE IF NOT EXISTS public.tb_academy_goal (
  id_academy          UUID PRIMARY KEY REFERENCES public.tb_academy(id_academy) ON DELETE CASCADE,
  freq_target_month   INT  NOT NULL DEFAULT 12 CHECK (freq_target_month BETWEEN 1 AND 31),
  posts_target_month  INT  NOT NULL DEFAULT 4  CHECK (posts_target_month BETWEEN 0 AND 100),
  shares_target_month INT  NOT NULL DEFAULT 4  CHECK (shares_target_month BETWEEN 0 AND 100),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
