-- =============================================================================
-- Migration 144: Casa Views - interacoes da audiencia
-- =============================================================================
-- Comentarios e likes no Ranking da Audiencia. O alvo vem do servico externo
-- casa-views-ranking (external_user_id). A autoria das interacoes e sempre a
-- conta user da Freelandoo (tb_user.id_user), sem subperfil.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.casa_audience_target (
  external_user_id VARCHAR(160) PRIMARY KEY,
  user_login       VARCHAR(160),
  avatar_url       TEXT,
  likes_count      INT NOT NULL DEFAULT 0 CHECK (likes_count >= 0),
  comments_count   INT NOT NULL DEFAULT 0 CHECK (comments_count >= 0),
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_casa_audience_target_last_seen
  ON public.casa_audience_target (last_seen_at DESC);

CREATE TABLE IF NOT EXISTS public.casa_audience_like (
  external_user_id VARCHAR(160) NOT NULL REFERENCES public.casa_audience_target(external_user_id) ON DELETE CASCADE,
  id_user          UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  liked_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (external_user_id, id_user)
);

CREATE INDEX IF NOT EXISTS idx_casa_audience_like_user
  ON public.casa_audience_like (id_user, liked_at DESC);

CREATE TABLE IF NOT EXISTS public.casa_audience_comment (
  id_casa_audience_comment UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_user_id         VARCHAR(160) NOT NULL REFERENCES public.casa_audience_target(external_user_id) ON DELETE CASCADE,
  id_user                  UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  content                  TEXT NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 1000),
  is_active                BOOLEAN NOT NULL DEFAULT TRUE,
  likes_count              INT NOT NULL DEFAULT 0 CHECK (likes_count >= 0),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_casa_audience_comment_target
  ON public.casa_audience_comment (external_user_id, is_active, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_casa_audience_comment_user
  ON public.casa_audience_comment (id_user, created_at DESC);

CREATE TABLE IF NOT EXISTS public.casa_audience_comment_like (
  id_casa_audience_comment UUID NOT NULL REFERENCES public.casa_audience_comment(id_casa_audience_comment) ON DELETE CASCADE,
  id_user                  UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  liked_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_casa_audience_comment, id_user)
);

CREATE INDEX IF NOT EXISTS idx_casa_audience_comment_like_user
  ON public.casa_audience_comment_like (id_user, liked_at DESC);

COMMENT ON TABLE public.casa_audience_target IS
  'Alvos do Ranking da Audiencia vindos do servico externo Casa Views.';

COMMENT ON TABLE public.casa_audience_comment IS
  'Comentarios do Ranking da Audiencia, sempre assinados pela conta user da Freelandoo.';
