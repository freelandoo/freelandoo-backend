-- =============================================================================
-- Migration 093: Course Requests — "Pedir Curso" (mural de alunos)
-- =============================================================================
-- Análogo a tb_service_request (mig 023) e tb_product_request (mig 070),
-- mas para cursos. Aluno escolhe enxame + profissão + descrição.
-- Matching: profissionais cujo subperfil bate em (enxame, profissão) E que
-- TÊM pelo menos um curso publicado. Sem filtro de cidade.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_course_request (
  id_course_request    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_buyer_user        UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  id_machine           INT          NOT NULL REFERENCES public.tb_machine(id_machine) ON DELETE RESTRICT,
  id_category          INT          NOT NULL REFERENCES public.tb_category(id_category) ON DELETE RESTRICT,
  description          TEXT         NOT NULL,
  status               VARCHAR(16)  NOT NULL DEFAULT 'OPEN'
                          CHECK (status IN ('OPEN','FULFILLED','CANCELED')),
  id_response_chosen   UUID,
  fulfilled_at         TIMESTAMPTZ,
  canceled_at          TIMESTAMPTZ,
  user_hidden_at       TIMESTAMPTZ,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_course_request_buyer
  ON public.tb_course_request (id_buyer_user, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_course_request_mural
  ON public.tb_course_request (id_machine, id_category, status);

-- ---------- Respostas (profissional ↔ pedido) ----------
CREATE TABLE IF NOT EXISTS public.tb_course_request_response (
  id_response          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_course_request    UUID         NOT NULL REFERENCES public.tb_course_request(id_course_request) ON DELETE CASCADE,
  id_profile           UUID         NOT NULL REFERENCES public.tb_profile(id_profile),
  id_course            UUID         REFERENCES public.courses(id) ON DELETE SET NULL,
  status               VARCHAR(24)  NOT NULL DEFAULT 'PRO_ACCEPTED'
                          CHECK (status IN ('PRO_ACCEPTED','PRO_REJECTED','USER_REJECTED','FINALIZED','CLOSED_OTHER_WON')),
  pro_accepted_at      TIMESTAMPTZ,
  pro_rejected_at      TIMESTAMPTZ,
  user_rejected_at     TIMESTAMPTZ,
  finalized_at         TIMESTAMPTZ,
  pro_last_read_at     TIMESTAMPTZ,
  user_last_read_at    TIMESTAMPTZ,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT tb_course_request_response_uq UNIQUE (id_course_request, id_profile)
);

CREATE INDEX IF NOT EXISTS ix_course_request_response_profile
  ON public.tb_course_request_response (id_profile, status);
CREATE INDEX IF NOT EXISTS ix_course_request_response_request
  ON public.tb_course_request_response (id_course_request);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tb_course_request_response_chosen_fk'
  ) THEN
    ALTER TABLE public.tb_course_request
      ADD CONSTRAINT tb_course_request_response_chosen_fk
      FOREIGN KEY (id_response_chosen) REFERENCES public.tb_course_request_response(id_response);
  END IF;
END$$;

-- ---------- Mensagens do chat por par ----------
CREATE TABLE IF NOT EXISTS public.tb_course_request_message (
  id_message           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_response          UUID         NOT NULL REFERENCES public.tb_course_request_response(id_response) ON DELETE CASCADE,
  sender               VARCHAR(8)   NOT NULL CHECK (sender IN ('USER','PRO')),
  content              TEXT         NOT NULL,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_course_request_message_response
  ON public.tb_course_request_message (id_response, created_at);
