-- =============================================================================
-- Migration 054: Comentários em items de portfólio (Feed + Bees)
-- =============================================================================
-- Qualquer item de portfólio (feed ou bees) pode receber comentários de usuários
-- autenticados. Soft-delete via is_active=false. Contador denormalizado no item.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_portfolio_comment (
  id_portfolio_comment UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_portfolio_item    UUID         NOT NULL REFERENCES public.tb_profile_portfolio_item(id_portfolio_item) ON DELETE CASCADE,
  id_user              UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  content              TEXT         NOT NULL,
  is_active            BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT tb_portfolio_comment_content_chk CHECK (char_length(btrim(content)) BETWEEN 1 AND 1000)
);

CREATE INDEX IF NOT EXISTS idx_portfolio_comment_item_date
  ON public.tb_portfolio_comment (id_portfolio_item, created_at DESC)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_portfolio_comment_user_date
  ON public.tb_portfolio_comment (id_user, created_at DESC)
  WHERE is_active = TRUE;

-- Contador denormalizado mantido pela aplicação.
ALTER TABLE public.tb_profile_portfolio_item
  ADD COLUMN IF NOT EXISTS comments_count INT NOT NULL DEFAULT 0;

-- Backfill (idempotente — sempre alinha com o que existe na tabela de comentários).
UPDATE public.tb_profile_portfolio_item ppi
   SET comments_count = COALESCE(sub.cnt, 0)
  FROM (
    SELECT id_portfolio_item, COUNT(*)::INT AS cnt
      FROM public.tb_portfolio_comment
     WHERE is_active = TRUE
     GROUP BY id_portfolio_item
  ) sub
 WHERE ppi.id_portfolio_item = sub.id_portfolio_item
   AND ppi.comments_count <> sub.cnt;
