-- =============================================================================
-- Migration 047: Matrículas e vendas de cursos (Slice 11)
-- =============================================================================
-- Registra o acesso do aluno ao curso e preserva o valor pago no momento da
-- compra. O checkout público de curso será conectado em slice posterior; este
-- schema já alimenta a área admin "Alunos / Vendas".

CREATE TABLE IF NOT EXISTS public.course_enrollments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id         UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  order_id          UUID REFERENCES public.tb_order(id_order) ON DELETE SET NULL,
  amount_paid_cents INT NOT NULL DEFAULT 0 CHECK (amount_paid_cents >= 0),
  currency          VARCHAR(3) NOT NULL DEFAULT 'BRL',
  status            TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','refunded','canceled')),
  enrolled_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (course_id, user_id)
);

CREATE INDEX IF NOT EXISTS ix_course_enrollments_course_status
  ON public.course_enrollments (course_id, status, enrolled_at DESC);

CREATE INDEX IF NOT EXISTS ix_course_enrollments_user_status
  ON public.course_enrollments (user_id, status, enrolled_at DESC);

CREATE INDEX IF NOT EXISTS ix_course_enrollments_order
  ON public.course_enrollments (order_id)
  WHERE order_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_course_enrollments_touch_updated_at
  ON public.course_enrollments;
CREATE TRIGGER trg_course_enrollments_touch_updated_at
  BEFORE UPDATE ON public.course_enrollments
  FOR EACH ROW
  EXECUTE FUNCTION public.courses_touch_updated_at();
