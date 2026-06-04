-- =============================================================================
-- Migration 114: Blog / Central de Conteúdo
-- =============================================================================
-- Blog público (guias práticos sobre como usar a Freelandoo) que serve como
-- camada de conteúdo editorial — necessária para SEO orgânico e para a
-- aprovação do Google AdSense (que reprovou o site por "conteúdo de baixo
-- valor": tudo de valor estava atrás de login).
--
-- Posts são gerenciados pelo admin (CRUD + troca de capa). Markdown no body.
-- Idempotente: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.blog_posts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             TEXT NOT NULL UNIQUE,
  title            TEXT NOT NULL,
  excerpt          TEXT,
  cover_url        TEXT,
  cover_alt        TEXT,
  body_md          TEXT NOT NULL DEFAULT '',
  category         TEXT,
  tags             TEXT[] NOT NULL DEFAULT '{}',
  status           TEXT NOT NULL DEFAULT 'draft',
  reading_minutes  INTEGER NOT NULL DEFAULT 1,
  seo_title        TEXT,
  seo_description  TEXT,
  author_name      TEXT NOT NULL DEFAULT 'Equipe Freelandoo',
  views            INTEGER NOT NULL DEFAULT 0,
  published_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by       UUID REFERENCES public.tb_user(id_user),
  updated_by       UUID REFERENCES public.tb_user(id_user),
  CONSTRAINT blog_posts_status_chk CHECK (status IN ('draft', 'published'))
);

CREATE INDEX IF NOT EXISTS ix_blog_posts_published
  ON public.blog_posts (status, published_at DESC);

CREATE INDEX IF NOT EXISTS ix_blog_posts_category
  ON public.blog_posts (category)
  WHERE status = 'published';
