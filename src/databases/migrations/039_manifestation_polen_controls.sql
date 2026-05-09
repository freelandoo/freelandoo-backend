-- =============================================================================
-- Migration 039: Controles de elegibilidade da Manifestacao no painel de Polens
-- =============================================================================
-- Admins podem liberar compra/uso para administradores, para users comuns e
-- definir nivel minimo de XP (maximo entre subperfis profissionais do usuario).

ALTER TABLE public.polen_settings
  ADD COLUMN IF NOT EXISTS manifestation_admin_enabled BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.polen_settings
  ADD COLUMN IF NOT EXISTS manifestation_users_enabled BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.polen_settings
  ADD COLUMN IF NOT EXISTS manifestation_min_xp_level INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.polen_settings
  DROP CONSTRAINT IF EXISTS polen_settings_manifestation_min_level_chk;

ALTER TABLE public.polen_settings
  ADD CONSTRAINT polen_settings_manifestation_min_level_chk
  CHECK (manifestation_min_xp_level >= 0);
