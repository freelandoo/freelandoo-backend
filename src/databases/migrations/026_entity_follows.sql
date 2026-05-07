-- =============================================================================
-- Migration 026: Acompanhamento polimorfico entre entidades publicas
-- =============================================================================
-- Entidades suportadas:
-- - profile: subperfil profissional (tb_profile.is_clan = FALSE)
-- - clan:    perfil-clan           (tb_profile.is_clan = TRUE)
--
-- A tabela usa soft delete para permitir reativar a mesma relacao sem perder
-- historico. A unicidade vale apenas para registros ativos.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.entity_follows (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_type VARCHAR(16) NOT NULL,
  follower_id   UUID        NOT NULL,
  target_type   VARCHAR(16) NOT NULL,
  target_id     UUID        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ NULL,
  CONSTRAINT entity_follows_follower_type_chk
    CHECK (follower_type IN ('profile', 'clan')),
  CONSTRAINT entity_follows_target_type_chk
    CHECK (target_type IN ('profile', 'clan')),
  CONSTRAINT entity_follows_no_self_chk
    CHECK (follower_type <> target_type OR follower_id <> target_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_entity_follows_active
  ON public.entity_follows (follower_type, follower_id, target_type, target_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_entity_follows_target_recent
  ON public.entity_follows (target_type, target_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_entity_follows_follower_recent
  ON public.entity_follows (follower_type, follower_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_entity_follows_status_lookup
  ON public.entity_follows (follower_type, follower_id, target_type, target_id)
  WHERE deleted_at IS NULL;

COMMIT;
