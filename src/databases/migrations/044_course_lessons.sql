-- =============================================================================
-- Migration 044: Aulas dentro de módulos (Slice 5)
-- =============================================================================
-- Cada aula pertence a um módulo (e indiretamente a um curso).
-- video_status modela o ciclo do vídeo da aula (Slices 7 e 8):
--   empty → uploading → processing → ready (ou error)
-- Reordenação por position (UNIQUE por módulo).

CREATE TABLE IF NOT EXISTS public.course_lessons (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id            UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  module_id            UUID NOT NULL REFERENCES public.course_modules(id) ON DELETE CASCADE,
  title                VARCHAR(160) NOT NULL,
  description          TEXT,
  position             INT NOT NULL DEFAULT 0,
  status               TEXT NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','published','hidden')),
  video_status         TEXT NOT NULL DEFAULT 'empty'
                       CHECK (video_status IN ('empty','uploading','processing','ready','error')),
  original_video_url   TEXT,
  processed_video_url  TEXT,
  thumbnail_url        TEXT,
  duration_seconds     INT CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ordem determinística dentro do módulo.
CREATE UNIQUE INDEX IF NOT EXISTS ux_course_lessons_module_position
  ON public.course_lessons (module_id, position);

-- Para listar todas as aulas publicadas de um curso (player do aluno, Slice 14).
CREATE INDEX IF NOT EXISTS ix_course_lessons_course_status
  ON public.course_lessons (course_id, status);

-- Para contar aulas por módulo (na engrenagem).
CREATE INDEX IF NOT EXISTS ix_course_lessons_module
  ON public.course_lessons (module_id);

-- Reusa a função touch_updated_at criada na migration 042.
DROP TRIGGER IF EXISTS trg_course_lessons_touch_updated_at ON public.course_lessons;
CREATE TRIGGER trg_course_lessons_touch_updated_at
  BEFORE UPDATE ON public.course_lessons
  FOR EACH ROW
  EXECUTE FUNCTION public.courses_touch_updated_at();
