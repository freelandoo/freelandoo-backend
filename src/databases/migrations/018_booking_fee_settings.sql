-- =============================================================================
-- Migration 018: Booking fee settings (taxa Stripe % + taxa fixa de serviço)
-- Singleton com id = 1, mesmo padrão de tb_annual_fee_settings.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_booking_fee_settings (
  id                   SMALLINT PRIMARY KEY,
  stripe_fee_percent   NUMERIC(5,2) NOT NULL DEFAULT 0,
  service_fee_cents    INTEGER      NOT NULL DEFAULT 0,
  is_active            BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_by           UUID,
  CONSTRAINT tb_booking_fee_singleton CHECK (id = 1)
);

INSERT INTO public.tb_booking_fee_settings (id, stripe_fee_percent, service_fee_cents, is_active)
VALUES (1, 0, 0, TRUE)
ON CONFLICT (id) DO NOTHING;
