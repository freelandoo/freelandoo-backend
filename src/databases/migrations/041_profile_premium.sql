-- =============================================================================
-- Migration 041: Premium (destaque) por perfil
-- =============================================================================
-- Premium = destaque temporário (N dias) comprado via Stripe ou Poléns.
-- Distinto da assinatura R$300/ano (esta apenas "ativa" o perfil na vitrine).
-- Sem reembolso (refunded_at reservado p/ DB manual). NÃO gera comissão.

-- ---------- Settings (singleton) ----------
CREATE TABLE IF NOT EXISTS public.premium_settings (
  id              INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  duration_days   INT NOT NULL DEFAULT 7 CHECK (duration_days > 0),
  price_cents     INT NOT NULL DEFAULT 5000 CHECK (price_cents > 0),
  price_polens    INT NOT NULL DEFAULT 500 CHECK (price_polens > 0),
  slots_per_city  INT NOT NULL DEFAULT 5 CHECK (slots_per_city >= 0),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.premium_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ---------- Override de preço/vagas por cidade ----------
CREATE TABLE IF NOT EXISTS public.premium_city_overrides (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uf            VARCHAR(2) NOT NULL,
  city_name     VARCHAR(120) NOT NULL,
  price_cents   INT CHECK (price_cents IS NULL OR price_cents > 0),
  price_polens  INT CHECK (price_polens IS NULL OR price_polens > 0),
  slots         INT CHECK (slots IS NULL OR slots >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_premium_city_overrides_key
  ON public.premium_city_overrides (uf, lower(city_name));

-- ---------- Ativações de premium por perfil ----------
CREATE TABLE IF NOT EXISTS public.profile_premium (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id               UUID NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  status                   TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','active','expired','failed')),
  activated_at             TIMESTAMPTZ,
  expires_at               TIMESTAMPTZ,
  is_active                BOOLEAN NOT NULL DEFAULT FALSE,
  payment_method           TEXT NOT NULL CHECK (payment_method IN ('stripe','polens')),
  amount_cents             INT,
  amount_polens            INT,
  stripe_session_id        TEXT,
  stripe_payment_intent    TEXT,
  uf                       VARCHAR(2) NOT NULL,
  city_name                VARCHAR(120) NOT NULL,
  refunded_at              TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotência do webhook Stripe
CREATE UNIQUE INDEX IF NOT EXISTS ux_profile_premium_session
  ON public.profile_premium (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;

-- 1 premium ativo por perfil (regra de negócio: bloquear nova compra enquanto ativo)
CREATE UNIQUE INDEX IF NOT EXISTS ux_profile_premium_active
  ON public.profile_premium (profile_id)
  WHERE is_active = TRUE;

-- Contagem de vagas por cidade
CREATE INDEX IF NOT EXISTS ix_profile_premium_city_active
  ON public.profile_premium (uf, lower(city_name))
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS ix_profile_premium_profile
  ON public.profile_premium (profile_id, is_active);

-- Adiciona 'spend_premium' ao enum de polen_transactions.type
ALTER TABLE public.polen_transactions
  DROP CONSTRAINT IF EXISTS polen_transactions_type_chk;

ALTER TABLE public.polen_transactions
  ADD CONSTRAINT polen_transactions_type_chk CHECK (
    type IN (
      'earn_rewarded_ad',
      'earn_purchase_stripe',
      'spend_profile_activation',
      'spend_premium_highlight',
      'spend_profile_boost',
      'spend_post_boost',
      'spend_clan_highlight',
      'spend_manifestation',
      'spend_premium',
      'admin_adjustment',
      'refund',
      'reversal'
    )
  );
