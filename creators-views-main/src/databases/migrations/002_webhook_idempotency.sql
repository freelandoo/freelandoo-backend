-- Migration 002: Harden MercadoPago webhook idempotency
-- Today PaymentController relies on `status` to be naturally idempotent. We add
-- a dedicated table keyed by MP payment id + status so repeated deliveries never
-- produce duplicate side effects (affiliate conversions, profile status flips).

CREATE TABLE IF NOT EXISTS public.tb_mp_webhook_event (
  id_event          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          VARCHAR(40) NOT NULL DEFAULT 'mercadopago',
  provider_payment_id VARCHAR(80) NOT NULL,
  mapped_status     VARCHAR(40) NOT NULL,
  external_reference VARCHAR(80),
  raw               JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tb_mp_webhook_event_uq
    UNIQUE (provider, provider_payment_id, mapped_status)
);

CREATE INDEX IF NOT EXISTS ix_tb_mp_webhook_event_ref
  ON public.tb_mp_webhook_event (external_reference, created_at DESC);
