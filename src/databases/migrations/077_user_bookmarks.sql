-- =============================================================================
-- Migration 077: User bookmarks with folders
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.user_bookmark_folder (
  id_folder UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  name VARCHAR(80) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id_user, name)
);

CREATE TABLE IF NOT EXISTS public.user_bookmark_item (
  id_bookmark UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  id_folder UUID NULL REFERENCES public.user_bookmark_folder(id_folder) ON DELETE SET NULL,
  id_portfolio_item UUID NOT NULL REFERENCES public.tb_profile_portfolio_item(id_portfolio_item) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id_user, id_portfolio_item)
);

CREATE INDEX IF NOT EXISTS idx_user_bookmark_folder_user
  ON public.user_bookmark_folder (id_user, sort_order, created_at);

CREATE INDEX IF NOT EXISTS idx_user_bookmark_item_user
  ON public.user_bookmark_item (id_user, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_bookmark_item_folder
  ON public.user_bookmark_item (id_folder, created_at DESC)
  WHERE id_folder IS NOT NULL;
