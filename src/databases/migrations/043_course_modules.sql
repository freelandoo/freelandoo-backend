-- =============================================================================
-- Migration 043: Módulos do curso (Slice 4)
-- =============================================================================
-- Módulos agrupam aulas dentro de um curso (Slice 5 cria aulas).
-- Reordenação manual via coluna `position` (INT, único por curso).
-- Status do módulo é independente do status do curso.

CREATE TABLE IF NOT EXISTS public.course_modules (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id    UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  title        VARCHAR(160) NOT NULL,
  description  VARCHAR(500),
  position     INT NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft','published','hidden')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Posição única por curso garante ordenação determinística e evita empate.
CREATE UNIQUE INDEX IF NOT EXISTS ux_course_modules_course_position
  ON public.course_modules (course_id, position);

CREATE INDEX IF NOT EXISTS ix_course_modules_course_status
  ON public.course_modules (course_id, status);

-- Reusa a função genérica de touch_updated_at criada na migration 042.
-- Caso outra migration tenha removido a função, garante recriação.
CREATE OR REPLACE FUNCTION public.courses_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_course_modules_touch_updated_at ON public.course_modules;
CREATE TRIGGER trg_course_modules_touch_updated_at
  BEFORE UPDATE ON public.course_modules
  FOR EACH ROW
  EXECUTE FUNCTION public.courses_touch_updated_at();
