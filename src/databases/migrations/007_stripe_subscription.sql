-- =============================================================================
-- Migration 007: Stripe subscription, annual fee settings, MP cleanup
-- =============================================================================

-- Drop MP-specific artifacts
DROP TABLE IF EXISTS public.payments CASCADE;
DROP TABLE IF EXISTS public.tb_mp_webhook_event CASCADE;

-- Status seed needed by activation flow
INSERT INTO public.tb_status (desc_status) VALUES
  ('taxa_pendente'),
  ('fee_paid')
ON CONFLICT (desc_status) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Singleton config for the annual subscription fee
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tb_annual_fee_settings (
  id                SMALLINT PRIMARY KEY,
  amount_cents      INTEGER NOT NULL DEFAULT 30000,
  currency          VARCHAR(3) NOT NULL DEFAULT 'BRL',
  stripe_price_id   TEXT,
  stripe_product_id TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by        UUID,
  CONSTRAINT tb_annual_fee_singleton CHECK (id = 1)
);

INSERT INTO public.tb_annual_fee_settings (id, amount_cents, currency)
VALUES (1, 30000, 'BRL')
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Profile subscription (Stripe)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tb_profile_subscription (
  id_subscription            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user                    UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  id_profile                 UUID REFERENCES public.tb_profile(id_profile) ON DELETE SET NULL,
  status                     VARCHAR(30) NOT NULL DEFAULT 'pending',
  amount_cents               INTEGER NOT NULL DEFAULT 0,
  currency                   VARCHAR(3) NOT NULL DEFAULT 'BRL',
  stripe_customer_id         TEXT,
  stripe_subscription_id     TEXT UNIQUE,
  stripe_checkout_session_id TEXT UNIQUE,
  stripe_price_id            TEXT,
  stripe_promotion_code      TEXT,
  id_coupon                  UUID REFERENCES public.tb_coupon(id_coupon),
  current_period_start       TIMESTAMPTZ,
  current_period_end         TIMESTAMPTZ,
  paid_at                    TIMESTAMPTZ,
  canceled_at                TIMESTAMPTZ,
  raw_event                  JSONB,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tb_profile_subscription_status_chk
    CHECK (status IN ('pending','active','past_due','canceled','expired','failed'))
);

CREATE INDEX IF NOT EXISTS ix_profile_subscription_user    ON public.tb_profile_subscription (id_user);
CREATE INDEX IF NOT EXISTS ix_profile_subscription_profile ON public.tb_profile_subscription (id_profile);
CREATE INDEX IF NOT EXISTS ix_profile_subscription_status  ON public.tb_profile_subscription (status);

-- -----------------------------------------------------------------------------
-- Stripe webhook idempotency
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tb_stripe_webhook_event (
  id_event     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     TEXT NOT NULL UNIQUE,
  event_type   TEXT NOT NULL,
  payload      JSONB NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_stripe_webhook_event_type
  ON public.tb_stripe_webhook_event (event_type, processed_at DESC);

-- -----------------------------------------------------------------------------
-- Coupon <-> Stripe promotion code sync
-- -----------------------------------------------------------------------------
ALTER TABLE public.tb_coupon
  ADD COLUMN IF NOT EXISTS stripe_coupon_id         TEXT,
  ADD COLUMN IF NOT EXISTS stripe_promotion_code_id TEXT;

CREATE INDEX IF NOT EXISTS ix_tb_coupon_stripe_promo
  ON public.tb_coupon (stripe_promotion_code_id)
  WHERE stripe_promotion_code_id IS NOT NULL;
