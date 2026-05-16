-- =============================================================================
-- Migration 060: Likes em comentários de posts (Feed + Bees)
-- =============================================================================
-- Cada comentário pode receber likes de usuários autenticados.
-- Contador denormalizado em tb_portfolio_comment.likes_count.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_portfolio_comment_like (
  id_portfolio_comment UUID         NOT NULL REFERENCES public.tb_portfolio_comment(id_portfolio_comment) ON DELETE CASCADE,
  id_user              UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_portfolio_comment, id_user)
);

CREATE INDEX IF NOT EXISTS idx_portfolio_comment_like_user
  ON public.tb_portfolio_comment_like (id_user, created_at DESC);

ALTER TABLE public.tb_portfolio_comment
  ADD COLUMN IF NOT EXISTS likes_count INT NOT NULL DEFAULT 0;

-- Backfill idempotente: realinha o contador com a tabela de likes.
UPDATE public.tb_portfolio_comment pc
   SET likes_count = COALESCE(sub.cnt, 0)
  FROM (
    SELECT id_portfolio_comment, COUNT(*)::INT AS cnt
      FROM public.tb_portfolio_comment_like
     GROUP BY id_portfolio_comment
  ) sub
 WHERE pc.id_portfolio_comment = sub.id_portfolio_comment
   AND pc.likes_count <> sub.cnt;
