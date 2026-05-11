-- =============================================================================
-- Migration 045: Materiais de apoio das aulas (Slice 9)
-- =============================================================================
-- Cada aula pode ter N materiais. Dois kinds:
--   * 'file' — arquivo armazenado no R2 (PDF, imagens)
--   * 'link' — URL externa (drive, youtube, etc)
-- Reordenação por position (UNIQUE por lesson).

CREATE TABLE IF NOT EXISTS public.course_lesson_materials (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id        UUID NOT NULL REFERENCES public.course_lessons(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL CHECK (kind IN ('file','link')),
  title            VARCHAR(200) NOT NULL,
  file_url         TEXT,
  file_size_bytes  BIGINT CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
  mime             TEXT,
  link_url         TEXT,
  position         INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Consistência entre kind e os campos preenchidos.
ALTER TABLE public.course_lesson_materials
  DROP CONSTRAINT IF EXISTS chk_course_lesson_materials_kind_consistency;
ALTER TABLE public.course_lesson_materials
  ADD CONSTRAINT chk_course_lesson_materials_kind_consistency CHECK (
    (kind = 'file' AND file_url IS NOT NULL AND link_url IS NULL) OR
    (kind = 'link' AND link_url IS NOT NULL AND file_url IS NULL)
  );

-- Ordem determinística dentro da aula.
CREATE UNIQUE INDEX IF NOT EXISTS ux_course_lesson_materials_lesson_position
  ON public.course_lesson_materials (lesson_id, position);

CREATE INDEX IF NOT EXISTS ix_course_lesson_materials_lesson
  ON public.course_lesson_materials (lesson_id);

-- Reusa a função touch_updated_at criada na migration 042.
DROP TRIGGER IF EXISTS trg_course_lesson_materials_touch_updated_at ON public.course_lesson_materials;
CREATE TRIGGER trg_course_lesson_materials_touch_updated_at
  BEFORE UPDATE ON public.course_lesson_materials
  FOR EACH ROW
  EXECUTE FUNCTION public.courses_touch_updated_at();
