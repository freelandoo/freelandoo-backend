-- =============================================================================
-- Migration 458 — Feed Interativo F5: Paths (post com caminhos alternativos)
-- =============================================================================
-- Uma HISTÓRIA é um grafo dirigido de nós ligados por escolhas (botões).
--   tb_path_story   a história; publicada = presa a UM post do autor
--                   (id_portfolio_item, único) — é esse post que carrega o
--                   botão "Começar" no feed. Rascunho não aparece para ninguém.
--   tb_path_node    um passo: título, texto, mídia emprestada de um post do
--                   próprio autor (id_media_item), final ou não, posição no mapa
--   tb_path_choice  um botão do nó: rótulo e o nó para onde leva
-- Analytics por caminho SEM rastrear pessoa: contadores (plays_count da
-- história, picks_count de cada escolha, reach_count de cada nó).
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_path_story (
  id_story           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user            UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  id_portfolio_item  UUID NULL REFERENCES public.tb_profile_portfolio_item(id_portfolio_item) ON DELETE SET NULL,
  title              TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL DEFAULT 'draft',
  id_root_node       UUID NULL,
  plays_count        INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at       TIMESTAMPTZ NULL
);
ALTER TABLE public.tb_path_story DROP CONSTRAINT IF EXISTS tb_path_story_status_chk;
ALTER TABLE public.tb_path_story
  ADD CONSTRAINT tb_path_story_status_chk CHECK (status IN ('draft', 'published'));
-- Um post carrega no máximo UMA história publicada.
CREATE UNIQUE INDEX IF NOT EXISTS uq_path_story_post_published
  ON public.tb_path_story (id_portfolio_item)
  WHERE status = 'published' AND id_portfolio_item IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_path_story_owner ON public.tb_path_story (id_user, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.tb_path_node (
  id_node        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_story       UUID NOT NULL REFERENCES public.tb_path_story(id_story) ON DELETE CASCADE,
  title          TEXT NOT NULL DEFAULT '',
  body           TEXT NOT NULL DEFAULT '',
  is_ending      BOOLEAN NOT NULL DEFAULT FALSE,
  id_media_item  UUID NULL REFERENCES public.tb_profile_portfolio_item(id_portfolio_item) ON DELETE SET NULL,
  pos_x          INTEGER NOT NULL DEFAULT 0,
  pos_y          INTEGER NOT NULL DEFAULT 0,
  reach_count    INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_path_node_story ON public.tb_path_node (id_story);

CREATE TABLE IF NOT EXISTS public.tb_path_choice (
  id_choice       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_node         UUID NOT NULL REFERENCES public.tb_path_node(id_node) ON DELETE CASCADE,
  label           TEXT NOT NULL,
  id_target_node  UUID NULL REFERENCES public.tb_path_node(id_node) ON DELETE SET NULL,
  sort            SMALLINT NOT NULL DEFAULT 0,
  picks_count     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_path_choice_node ON public.tb_path_choice (id_node, sort);
