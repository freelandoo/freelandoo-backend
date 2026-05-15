-- =============================================================================
-- Migration 055: Stories (Trampo / Rests)
-- =============================================================================
-- Vídeos efêmeros (24h) postados por um subperfil (tb_profile). Dois canais:
--   'trampo' — exclusivo de subperfis pagos (não-clan, assinatura ativa).
--             Aparece na faixa horizontal da página /maquinas.
--   'rest'   — qualquer subperfil ativo. Aparece na faixa de /feed.
-- Várias stories simultâneas por subperfil são permitidas; frontend divide
-- vídeos maiores que 60s em segmentos de 60s antes de subir.
--
-- tb_story_view registra quem assistiu cada story; usado na faixa para
-- decidir se a borda metálica fica acesa (não-visto) ou transparente (visto).
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.tb_story (
  id_story          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_profile        UUID NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_user           UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  kind              VARCHAR(10) NOT NULL,
  video_url         TEXT NOT NULL,
  thumbnail_url     TEXT,
  storage_key       TEXT,
  thumbnail_key     TEXT,
  duration_seconds  INTEGER NOT NULL,
  width             INTEGER,
  height            INTEGER,
  caption           TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMPTZ NOT NULL,
  deleted_at        TIMESTAMPTZ
);

ALTER TABLE public.tb_story
  DROP CONSTRAINT IF EXISTS tb_story_kind_chk;
ALTER TABLE public.tb_story
  ADD CONSTRAINT tb_story_kind_chk
  CHECK (kind IN ('trampo', 'rest'));

ALTER TABLE public.tb_story
  DROP CONSTRAINT IF EXISTS tb_story_duration_chk;
ALTER TABLE public.tb_story
  ADD CONSTRAINT tb_story_duration_chk
  CHECK (duration_seconds > 0 AND duration_seconds <= 60);

CREATE INDEX IF NOT EXISTS ix_story_active_by_kind
  ON public.tb_story (kind, expires_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_story_user_active
  ON public.tb_story (id_user, expires_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_story_profile_active
  ON public.tb_story (id_profile, expires_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_story_expires_at
  ON public.tb_story (expires_at)
  WHERE deleted_at IS NULL;

-- =============================================================================
-- Visualizações (consumido por Slice 2 — endpoint feed agregado + mark-as-viewed)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.tb_story_view (
  id_story        UUID NOT NULL REFERENCES public.tb_story(id_story) ON DELETE CASCADE,
  id_viewer_user  UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  viewed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_story, id_viewer_user)
);

CREATE INDEX IF NOT EXISTS ix_story_view_viewer
  ON public.tb_story_view (id_viewer_user);

COMMIT;
