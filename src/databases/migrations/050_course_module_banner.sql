-- =============================================================================
-- Migration 050: Banner do módulo de curso
-- =============================================================================
-- Adiciona `banner_url` em course_modules. Usado pela landing page do módulo
-- (refactor de UX dos cursos: cada módulo agora tem página própria com hero
-- visual de banner). Idempotente.

ALTER TABLE public.course_modules
  ADD COLUMN IF NOT EXISTS banner_url TEXT;
