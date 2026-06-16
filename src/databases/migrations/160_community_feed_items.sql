-- =============================================================================
-- Migration 160: Feed da comunidade estilo grupo (posts dos membros)
-- Liga um portfolio-item (post/bee de um MEMBRO) ao feed de uma comunidade.
-- O post continua sendo um post normal do autor (aparece no perfil dele, no
-- /feed global, conta XP); o link só faz ele subir TAMBÉM no feed da comunidade.
-- posts e bees entram no mesmo feed (feed_kind preservado no item). Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_community_feed_item (
  id                   BIGSERIAL    PRIMARY KEY,
  id_community_profile UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_portfolio_item    UUID         NOT NULL REFERENCES public.tb_profile_portfolio_item(id_portfolio_item) ON DELETE CASCADE,
  id_author_user       UUID         NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Um item aparece no máximo uma vez por comunidade.
CREATE UNIQUE INDEX IF NOT EXISTS ux_community_feed_item
  ON public.tb_community_feed_item (id_community_profile, id_portfolio_item);

CREATE INDEX IF NOT EXISTS idx_community_feed_item_comm
  ON public.tb_community_feed_item (id_community_profile, created_at DESC);
