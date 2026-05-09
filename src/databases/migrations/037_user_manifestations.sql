-- =============================================================================
-- Migration 037: Manifestação ativa por user + toggle por subperfil
-- =============================================================================
-- Apenas 1 manifestação ativa por user. Aplica sempre no username (account/page).
-- Aplica em subperfis apenas via toggle em user_manifestation_profile_apply.
-- Clans NUNCA aplicam (regra validada no backend, não há FK específica).

CREATE TABLE IF NOT EXISTS public.user_manifestations (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  product_id               UUID NOT NULL REFERENCES public.manifestation_products(id) ON DELETE RESTRICT,
  acquired_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at               TIMESTAMPTZ NOT NULL,
  is_active                BOOLEAN NOT NULL DEFAULT TRUE,
  payment_method           TEXT NOT NULL CHECK (payment_method IN ('stripe','polens')),
  stripe_session_id        TEXT,
  stripe_payment_intent    TEXT,
  amount_cents             INTEGER,
  amount_polens            INTEGER,
  refunded_at              TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_user_manifestations_active
  ON public.user_manifestations (user_id) WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS ix_user_manifestations_user
  ON public.user_manifestations (user_id, is_active);

CREATE INDEX IF NOT EXISTS ix_user_manifestations_product
  ON public.user_manifestations (product_id, is_active);

CREATE UNIQUE INDEX IF NOT EXISTS ux_user_manifestations_stripe_session
  ON public.user_manifestations (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.user_manifestation_profile_apply (
  user_manifestation_id  UUID NOT NULL REFERENCES public.user_manifestations(id) ON DELETE CASCADE,
  profile_id             UUID NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  enabled_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_manifestation_id, profile_id)
);

CREATE INDEX IF NOT EXISTS ix_user_manifestation_apply_profile
  ON public.user_manifestation_profile_apply (profile_id);
