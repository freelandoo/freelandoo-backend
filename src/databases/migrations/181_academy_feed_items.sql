-- =============================================================================
-- Migration 181: Feed da academia no sistema de portfólio (igual comunidade)
-- Liga um portfolio-item (post/bee de um MEMBRO/staff) ao feed de uma academia.
-- Espelha tb_community_feed_item (mig 160): o post continua sendo um post normal
-- do autor (aparece no perfil dele, no /feed global com a TAG da academia, conta
-- XP); o link só faz ele subir TAMBÉM no feed da academia. Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_academy_feed_item (
  id                BIGSERIAL    PRIMARY KEY,
  id_academy        UUID         NOT NULL REFERENCES public.tb_academy(id_academy) ON DELETE CASCADE,
  id_portfolio_item UUID         NOT NULL REFERENCES public.tb_profile_portfolio_item(id_portfolio_item) ON DELETE CASCADE,
  id_author_user    UUID         NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Um item aparece no máximo uma vez por academia.
CREATE UNIQUE INDEX IF NOT EXISTS ux_academy_feed_item
  ON public.tb_academy_feed_item (id_academy, id_portfolio_item);

CREATE INDEX IF NOT EXISTS idx_academy_feed_item_acad
  ON public.tb_academy_feed_item (id_academy, created_at DESC);
