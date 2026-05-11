-- =============================================================================
-- Migration 049: Comentários das aulas (Slice 15)
-- =============================================================================
-- Alunos matriculados comentam em aulas publicadas. O criador do curso pode
-- moderar removendo comentários da própria aula.

CREATE TABLE IF NOT EXISTS public.course_lesson_comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id  UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  lesson_id  UUID NOT NULL REFERENCES public.course_lessons(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active'
             CHECK (status IN ('active','deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_course_lesson_comments_lesson_active
  ON public.course_lesson_comments (lesson_id, created_at DESC)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS ix_course_lesson_comments_course_active
  ON public.course_lesson_comments (course_id, created_at DESC)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS ix_course_lesson_comments_user
  ON public.course_lesson_comments (user_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_course_lesson_comments_touch_updated_at
  ON public.course_lesson_comments;
CREATE TRIGGER trg_course_lesson_comments_touch_updated_at
  BEFORE UPDATE ON public.course_lesson_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.courses_touch_updated_at();
