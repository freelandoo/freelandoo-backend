-- =============================================================================
-- Migration 050: Publicacao de cursos no feed (Slice 16)
-- =============================================================================
-- O feed publico ja renderiza itens de portfolio. Esta tabela liga um curso ao
-- item de portfolio criado para divulga-lo, mantendo o courses.feed_post_id como
-- atalho para o post publico.

CREATE TABLE IF NOT EXISTS public.course_feed_publications (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id          UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  portfolio_item_id  UUID NOT NULL REFERENCES public.tb_profile_portfolio_item(id_portfolio_item) ON DELETE CASCADE,
  message            TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (course_id),
  UNIQUE (portfolio_item_id)
);

CREATE INDEX IF NOT EXISTS ix_course_feed_publications_course
  ON public.course_feed_publications (course_id);

CREATE INDEX IF NOT EXISTS ix_course_feed_publications_portfolio_item
  ON public.course_feed_publications (portfolio_item_id);

DROP TRIGGER IF EXISTS trg_course_feed_publications_touch_updated_at
  ON public.course_feed_publications;
CREATE TRIGGER trg_course_feed_publications_touch_updated_at
  BEFORE UPDATE ON public.course_feed_publications
  FOR EACH ROW
  EXECUTE FUNCTION public.courses_touch_updated_at();
