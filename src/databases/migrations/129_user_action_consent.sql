-- =============================================================================
-- Migration 129: Aceite de termos por ação crítica (consent gates)
-- =============================================================================
-- Guarda o aceite mais recente por (usuário, ação), com versão e prova (ip/ua).
-- PK composta = upsert atualiza versão/data. Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_user_action_consent (
  id_user        UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  action_key     VARCHAR(40)  NOT NULL,
  terms_version  INT          NOT NULL,
  accepted_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  ip             VARCHAR(64),
  user_agent     TEXT,
  PRIMARY KEY (id_user, action_key)
);
