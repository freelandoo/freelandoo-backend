-- =============================================================================
-- Migration 167: Configuração do tour de boas-vindas (admin)
-- =============================================================================
-- Controla o auto-aparecimento do tour (/bem-vindo):
--   is_enabled : liga/desliga o auto-tour por completo.
--   audience   : 'all' (todos) ou 'admin' (só admins veem auto).
--   show_mode  : 'once' (só 1ª vez, usa onboarding_tour_done) ou
--                'always' (toda vez que entra — útil pro admin enquanto edita).
-- Singleton (id=1). Default = comportamento normal (todos / 1ª vez). Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tour_settings (
  id          INT          PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  is_enabled  BOOLEAN      NOT NULL DEFAULT TRUE,
  audience    VARCHAR(10)  NOT NULL DEFAULT 'all'  CHECK (audience IN ('all','admin')),
  show_mode   VARCHAR(10)  NOT NULL DEFAULT 'once' CHECK (show_mode IN ('once','always')),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_by  UUID         NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL
);

INSERT INTO public.tour_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
