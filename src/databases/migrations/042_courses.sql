-- =============================================================================
-- Migration 042: Cursos (Slice 2 — CRUD básico)
-- =============================================================================
-- Qualquer usuário logado pode criar cursos. Curso novo nasce em 'draft'.
-- Para publicar: title obrigatório, price_cents >= 500 (R$ 5,00 mínimo).
-- Tabelas de módulos, aulas, materiais, compras vêm em migrations seguintes.

-- ---------- Tabela principal de cursos ----------
CREATE TABLE IF NOT EXISTS public.courses (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id      UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  profile_id         UUID REFERENCES public.tb_profile(id_profile) ON DELETE SET NULL,
  title              VARCHAR(160) NOT NULL,
  slug               VARCHAR(96),
  short_description  VARCHAR(280),
  description        TEXT,
  cover_url          TEXT,
  price_cents        INT CHECK (price_cents IS NULL OR price_cents >= 0),
  status             TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','published','paused')),
  feed_post_id       UUID,
  published_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Slug único (quando preenchido)
CREATE UNIQUE INDEX IF NOT EXISTS ux_courses_slug
  ON public.courses (slug)
  WHERE slug IS NOT NULL;

-- Listagem de "Cursos criados por mim"
CREATE INDEX IF NOT EXISTS ix_courses_owner_created
  ON public.courses (owner_user_id, created_at DESC);

-- Listagem pública por perfil vinculado
CREATE INDEX IF NOT EXISTS ix_courses_profile_status
  ON public.courses (profile_id, status)
  WHERE profile_id IS NOT NULL;

-- Listagem pública geral
CREATE INDEX IF NOT EXISTS ix_courses_status_published
  ON public.courses (status, published_at DESC)
  WHERE status = 'published';

-- Trigger para manter updated_at sempre fresco
CREATE OR REPLACE FUNCTION public.courses_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_courses_touch_updated_at ON public.courses;
CREATE TRIGGER trg_courses_touch_updated_at
  BEFORE UPDATE ON public.courses
  FOR EACH ROW
  EXECUTE FUNCTION public.courses_touch_updated_at();
