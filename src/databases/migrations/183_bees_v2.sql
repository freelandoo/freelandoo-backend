-- =============================================================================
-- Migration 183: Bees v2 — stories viram "bees" com engajamento completo
-- =============================================================================
-- Spec: docs/superpowers/specs/2026-07-10-bees-v2-stories-design.md
-- kind ganha 'bee' (trampo/rest ficam VÁLIDOS no CHECK — histórico; linhas
-- vivas expiram sozinhas em 24h, zero migração de dados). Bee novo:
--   expires_at = created_at + 7d (TETO DURO, p/ limpeza R2);
--   visibilidade efetiva é lazy: NOW() < created+24h + score*1h (cap 7d).
-- engagement_score do bee = likes*1 + comments*2 + shares*3 (comentário
-- pontua no bee — é o sinal da extensão de vida; post não pontua comentário).
-- =============================================================================

BEGIN;

ALTER TABLE public.tb_story
  DROP CONSTRAINT IF EXISTS tb_story_kind_chk;
ALTER TABLE public.tb_story
  ADD CONSTRAINT tb_story_kind_chk
  CHECK (kind IN ('trampo', 'rest', 'bee'));

ALTER TABLE public.tb_story
  ADD COLUMN IF NOT EXISTS likes_count       INT     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comments_count    INT     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shares_count      INT     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS impressions_count INT     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS engagement_score  NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS location          TEXT,
  ADD COLUMN IF NOT EXISTS links             JSONB   NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS ix_story_bee_timeline
  ON public.tb_story (created_at DESC)
  WHERE deleted_at IS NULL AND kind = 'bee';

CREATE INDEX IF NOT EXISTS ix_story_bee_score
  ON public.tb_story (engagement_score DESC, created_at DESC)
  WHERE deleted_at IS NULL AND kind = 'bee';

-- ── Curtidas ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_story_like (
  id_story   UUID NOT NULL REFERENCES public.tb_story(id_story) ON DELETE CASCADE,
  id_user    UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_story, id_user)
);
CREATE INDEX IF NOT EXISTS ix_story_like_user
  ON public.tb_story_like (id_user, created_at DESC);

-- ── Comentários (espelho da tb_portfolio_comment, mig 054/060) ─────────────
CREATE TABLE IF NOT EXISTS public.tb_story_comment (
  id_story_comment UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  id_story         UUID        NOT NULL REFERENCES public.tb_story(id_story) ON DELETE CASCADE,
  id_user          UUID        NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  content          TEXT        NOT NULL,
  likes_count      INT         NOT NULL DEFAULT 0,
  is_active        BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tb_story_comment_content_chk CHECK (char_length(btrim(content)) BETWEEN 1 AND 1000)
);
CREATE INDEX IF NOT EXISTS ix_story_comment_story_date
  ON public.tb_story_comment (id_story, created_at DESC)
  WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS public.tb_story_comment_like (
  id_story_comment UUID NOT NULL REFERENCES public.tb_story_comment(id_story_comment) ON DELETE CASCADE,
  id_user          UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_story_comment, id_user)
);

-- ── Denúncias (espelho da tb_post_report, mig 081) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_story_report (
  id_story_report  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  id_story         UUID        NOT NULL REFERENCES public.tb_story(id_story) ON DELETE CASCADE,
  reporter_user_id UUID        NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  reason_category  VARCHAR(32) NOT NULL,
  reason           TEXT,
  resolved_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id_story, reporter_user_id)
);
CREATE INDEX IF NOT EXISTS ix_story_report_story
  ON public.tb_story_report (id_story, created_at DESC);

-- ── Salvos (bookmark some junto com o bee — filtro na leitura) ──────────────
CREATE TABLE IF NOT EXISTS public.tb_story_bookmark (
  id_story   UUID NOT NULL REFERENCES public.tb_story(id_story) ON DELETE CASCADE,
  id_user    UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_story, id_user)
);
CREATE INDEX IF NOT EXISTS ix_story_bookmark_user
  ON public.tb_story_bookmark (id_user, created_at DESC);

-- ── Eventos (share etc. — dedupe por sessão, espelho mínimo do feed) ───────
CREATE TABLE IF NOT EXISTS public.tb_story_event (
  id_story_event UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  id_story       UUID        NOT NULL REFERENCES public.tb_story(id_story) ON DELETE CASCADE,
  id_user        UUID        REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  session_id     VARCHAR(64),
  event_type     VARCHAR(30) NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_story_event_dedupe
  ON public.tb_story_event (id_story, session_id, event_type, created_at DESC);

COMMIT;
