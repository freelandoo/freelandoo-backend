-- =============================================================================
-- Migration 156: Votação de liderança da comunidade
-- Abre quando a comunidade estagna (Slice 4 getEligibleForVote) e existe um
-- membro de nível maior que o líder. Líder × desafiante; janela 7 dias; maioria
-- simples; empate mantém; líder destituído vira vice. Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_community_leadership_vote (
  id_vote            BIGSERIAL   PRIMARY KEY,
  id_community       UUID        NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_leader_user     UUID        NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  id_challenger_user UUID        NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  status             VARCHAR(16) NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','closed','canceled')),
  result             VARCHAR(16) NULL
                     CHECK (result IN ('leader_kept','leader_changed','tie_kept')),
  opens_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closes_at          TIMESTAMPTZ NOT NULL,
  resolved_at        TIMESTAMPTZ NULL
);

-- No máximo 1 votação aberta por comunidade.
CREATE UNIQUE INDEX IF NOT EXISTS ux_comm_vote_open
  ON public.tb_community_leadership_vote (id_community)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_comm_vote_open_due
  ON public.tb_community_leadership_vote (closes_at)
  WHERE status = 'open';

CREATE TABLE IF NOT EXISTS public.tb_community_vote_ballot (
  id_vote   BIGINT      NOT NULL REFERENCES public.tb_community_leadership_vote(id_vote) ON DELETE CASCADE,
  id_user   UUID        NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  choice    VARCHAR(16) NOT NULL CHECK (choice IN ('leader','challenger')),
  voted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_vote, id_user)
);
