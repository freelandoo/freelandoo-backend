-- =============================================================================
-- Migration 127: Perfis anexados a um curso de clan (co-autores que dividem)
-- =============================================================================
-- Cursos de clan podem anexar membros do clan como co-autores. A venda do curso
-- é dividida IGUAL entre esses perfis (tb_clan_payout). Só faz sentido pra cursos
-- cujo profile_id é um clan; pra cursos normais a tabela fica vazia. Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_course_member (
  course_id         UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  id_member_profile UUID NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (course_id, id_member_profile)
);

CREATE INDEX IF NOT EXISTS idx_course_member_profile
  ON public.tb_course_member (id_member_profile);
