-- =============================================================================
-- Migration 199: Enquetes do condomínio
-- Enquete GERAL do prédio ("trocar o portão?", "que dia é a assembleia?").
-- NÃO tem relação com a votação de liderança da comunidade (mig 156,
-- tb_community_leadership_vote) — aquela decide quem lidera; esta é consulta
-- entre moradores e não muda papel de ninguém.
--
-- Voto: 1 por morador CONFIRMADO (titular de unidade). A chave primária
-- (id_poll, id_user) é o que garante "vota uma vez só" — não depende de
-- checagem na aplicação.
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_condo_poll (
  id_poll     BIGSERIAL     PRIMARY KEY,
  id_condo    UUID          NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_author   UUID          NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  question    VARCHAR(280)  NOT NULL,
  description VARCHAR(1000) NULL,
  status      VARCHAR(10)   NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'closed')),
  closes_at   TIMESTAMPTZ   NULL,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  closed_at   TIMESTAMPTZ   NULL
);

CREATE INDEX IF NOT EXISTS idx_condo_poll_open
  ON public.tb_condo_poll (id_condo, created_at DESC)
  WHERE status = 'open';

CREATE TABLE IF NOT EXISTS public.tb_condo_poll_option (
  id_option BIGSERIAL    PRIMARY KEY,
  id_poll   BIGINT       NOT NULL REFERENCES public.tb_condo_poll(id_poll) ON DELETE CASCADE,
  label     VARCHAR(120) NOT NULL,
  position  INT          NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_condo_poll_option_poll
  ON public.tb_condo_poll_option (id_poll, position);

-- Um voto por morador. A PK é a regra.
CREATE TABLE IF NOT EXISTS public.tb_condo_poll_vote (
  id_poll   BIGINT      NOT NULL REFERENCES public.tb_condo_poll(id_poll) ON DELETE CASCADE,
  id_user   UUID        NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  id_option BIGINT      NOT NULL REFERENCES public.tb_condo_poll_option(id_option) ON DELETE CASCADE,
  voted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_poll, id_user)
);

CREATE INDEX IF NOT EXISTS idx_condo_poll_vote_option
  ON public.tb_condo_poll_vote (id_option);
