-- =============================================================================
-- Migration 017: Clan Service Members
-- Liga um tb_profile_service (de um clan) aos membros que participam dele.
-- Quando vazio, interpretado como "todos os membros do clan" no momento do split.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.tb_profile_service_member (
  id_profile_service  BIGINT      NOT NULL REFERENCES public.tb_profile_service(id_profile_service) ON DELETE CASCADE,
  id_member_profile   UUID        NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_profile_service, id_member_profile)
);

CREATE INDEX IF NOT EXISTS idx_profile_service_member_member
  ON public.tb_profile_service_member (id_member_profile);

COMMIT;
