-- =============================================================================
-- Migration 012: Profile Services — catálogo de serviços por perfil
-- =============================================================================

-- ─── Tabela de serviços ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_profile_service (
  id_profile_service  BIGSERIAL    PRIMARY KEY,
  id_profile          UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  name                VARCHAR(160) NOT NULL,
  description         TEXT,
  duration_minutes    INT          NOT NULL DEFAULT 60 CHECK (duration_minutes > 0),
  price_amount        INT          NOT NULL DEFAULT 0  CHECK (price_amount >= 0), -- centavos
  currency            VARCHAR(3)   NOT NULL DEFAULT 'BRL',
  is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
  deleted_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profile_service_profile
  ON public.tb_profile_service (id_profile)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_profile_service_active
  ON public.tb_profile_service (id_profile, is_active)
  WHERE deleted_at IS NULL;

-- ─── Liga bookings ao serviço escolhido ──────────────────────────────────────
ALTER TABLE public.tb_profile_bookings
  ADD COLUMN IF NOT EXISTS id_profile_service     BIGINT REFERENCES public.tb_profile_service(id_profile_service) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS service_name_snapshot  VARCHAR(160),
  ADD COLUMN IF NOT EXISTS service_price_amount   INT;

CREATE INDEX IF NOT EXISTS idx_bookings_service
  ON public.tb_profile_bookings (id_profile_service)
  WHERE id_profile_service IS NOT NULL;
