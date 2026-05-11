-- =============================================================================
-- Migration 048: Progresso do aluno nas aulas (Slice 13)
-- =============================================================================
-- Uma linha por aluno/aula. O progresso percentual do curso é calculado sobre
-- aulas publicadas do curso; completed_at nulo significa não concluída.

CREATE TABLE IF NOT EXISTS public.course_lesson_progress (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id    UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  lesson_id    UUID NOT NULL REFERENCES public.course_lessons(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (lesson_id, user_id)
);

CREATE INDEX IF NOT EXISTS ix_course_lesson_progress_user_course
  ON public.course_lesson_progress (user_id, course_id);

CREATE INDEX IF NOT EXISTS ix_course_lesson_progress_course_completed
  ON public.course_lesson_progress (course_id, completed_at)
  WHERE completed_at IS NOT NULL;

DROP TRIGGER IF EXISTS trg_course_lesson_progress_touch_updated_at
  ON public.course_lesson_progress;
CREATE TRIGGER trg_course_lesson_progress_touch_updated_at
  BEFORE UPDATE ON public.course_lesson_progress
  FOR EACH ROW
  EXECUTE FUNCTION public.courses_touch_updated_at();
