-- =============================================================================
-- Migration 147: Ranking social - likes e comentarios no /ranking
-- =============================================================================
-- Espelha o modelo do Ranking da Audiencia da Casa Views (mig 144), mas o alvo
-- e um perfil/clan da propria Freelandoo (tb_profile). A autoria das interacoes
-- e sempre a conta user (tb_user.id_user), sem subperfil.
-- Nao confundir com portfolio_likes: o heart do ranking passa a ser um like
-- direto no perfil dentro do contexto do ranking.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.ranking_profile_like (
  id_profile UUID NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_user    UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  liked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_profile, id_user)
);

CREATE INDEX IF NOT EXISTS idx_ranking_profile_like_user
  ON public.ranking_profile_like (id_user, liked_at DESC);

CREATE TABLE IF NOT EXISTS public.ranking_comment (
  id_ranking_comment UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_profile         UUID NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_user            UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  content            TEXT NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 1000),
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  likes_count        INT NOT NULL DEFAULT 0 CHECK (likes_count >= 0),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ranking_comment_profile
  ON public.ranking_comment (id_profile, is_active, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ranking_comment_user
  ON public.ranking_comment (id_user, created_at DESC);

CREATE TABLE IF NOT EXISTS public.ranking_comment_like (
  id_ranking_comment UUID NOT NULL REFERENCES public.ranking_comment(id_ranking_comment) ON DELETE CASCADE,
  id_user            UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  liked_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_ranking_comment, id_user)
);

CREATE INDEX IF NOT EXISTS idx_ranking_comment_like_user
  ON public.ranking_comment_like (id_user, liked_at DESC);

COMMENT ON TABLE public.ranking_profile_like IS
  'Likes diretos em perfis/clans no contexto do /ranking, assinados pela conta user.';

COMMENT ON TABLE public.ranking_comment IS
  'Comentarios do /ranking sobre perfis/clans, sempre assinados pela conta user da Freelandoo.';
