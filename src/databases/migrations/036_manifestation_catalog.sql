-- =============================================================================
-- Migration 036: Manifestação — catálogo (categorias + produtos)
-- =============================================================================
-- Loja de banners + tags. Cada produto = banner (imagem hero) + tag (label/cor/ícone).
-- Pago em R$ via Stripe (price_data ad-hoc) ou em Poléns.

CREATE TABLE IF NOT EXISTS public.manifestation_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_manifestation_categories_active_order
  ON public.manifestation_categories (is_active, sort_order);

CREATE TABLE IF NOT EXISTS public.manifestation_products (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id         UUID REFERENCES public.manifestation_categories(id) ON DELETE SET NULL,
  name                TEXT NOT NULL,
  description         TEXT,
  banner_url          TEXT NOT NULL,
  banner_thumb_url    TEXT,
  tag_label           TEXT NOT NULL,
  tag_color           TEXT NOT NULL DEFAULT 'emerald',
  tag_icon            TEXT,
  price_cents         INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  price_polens        INTEGER NOT NULL DEFAULT 0 CHECK (price_polens >= 0),
  duration_days       INTEGER NOT NULL DEFAULT 365 CHECK (duration_days > 0),
  stock               INTEGER,
  is_featured         BOOLEAN NOT NULL DEFAULT FALSE,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  stripe_product_id   TEXT,
  stripe_price_id     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_manifestation_products_featured
  ON public.manifestation_products ((TRUE))
  WHERE is_featured = TRUE AND is_active = TRUE;

CREATE INDEX IF NOT EXISTS ix_manifestation_products_category
  ON public.manifestation_products (category_id, sort_order);

CREATE INDEX IF NOT EXISTS ix_manifestation_products_active
  ON public.manifestation_products (is_active, sort_order);
