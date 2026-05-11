-- =============================================================================
-- Migration 046: Questionário das aulas (Slice 10)
-- =============================================================================
-- Cada aula pode ter N perguntas de múltipla escolha. Cada pergunta tem
-- N opções e exatamente 1 marcada como is_correct.
-- A validação de "exatamente 1 correta" é feita no service (não no banco)
-- porque adicionar/remover opções gera estados intermediários inválidos.

-- ---------- Perguntas ----------
CREATE TABLE IF NOT EXISTS public.course_lesson_questions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id   UUID NOT NULL REFERENCES public.course_lessons(id) ON DELETE CASCADE,
  prompt      TEXT NOT NULL,
  position    INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_course_lesson_questions_lesson_position
  ON public.course_lesson_questions (lesson_id, position);

CREATE INDEX IF NOT EXISTS ix_course_lesson_questions_lesson
  ON public.course_lesson_questions (lesson_id);

DROP TRIGGER IF EXISTS trg_course_lesson_questions_touch_updated_at
  ON public.course_lesson_questions;
CREATE TRIGGER trg_course_lesson_questions_touch_updated_at
  BEFORE UPDATE ON public.course_lesson_questions
  FOR EACH ROW
  EXECUTE FUNCTION public.courses_touch_updated_at();

-- ---------- Opções ----------
CREATE TABLE IF NOT EXISTS public.course_lesson_question_options (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id  UUID NOT NULL REFERENCES public.course_lesson_questions(id) ON DELETE CASCADE,
  label        TEXT NOT NULL,
  is_correct   BOOLEAN NOT NULL DEFAULT FALSE,
  position     INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_course_lesson_question_options_q_position
  ON public.course_lesson_question_options (question_id, position);

CREATE INDEX IF NOT EXISTS ix_course_lesson_question_options_question
  ON public.course_lesson_question_options (question_id);

DROP TRIGGER IF EXISTS trg_course_lesson_question_options_touch_updated_at
  ON public.course_lesson_question_options;
CREATE TRIGGER trg_course_lesson_question_options_touch_updated_at
  BEFORE UPDATE ON public.course_lesson_question_options
  FOR EACH ROW
  EXECUTE FUNCTION public.courses_touch_updated_at();
