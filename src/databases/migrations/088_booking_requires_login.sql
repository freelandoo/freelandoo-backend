-- =============================================================================
-- Migration 088 — booking exige usuário logado
-- =============================================================================
-- Adiciona id_client_user em tb_profile_bookings. A partir de agora todo
-- booking precisa de um cliente autenticado; o middleware de auth garante isso
-- no backend. A coluna fica nullable pra não invalidar bookings legados (que
-- usavam apenas client_email).
-- =============================================================================

ALTER TABLE public.tb_profile_bookings
  ADD COLUMN IF NOT EXISTS id_client_user UUID
  REFERENCES public.tb_user(id_user) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_client_user
  ON public.tb_profile_bookings (id_client_user)
  WHERE id_client_user IS NOT NULL;
