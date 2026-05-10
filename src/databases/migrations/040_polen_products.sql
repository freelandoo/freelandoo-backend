-- =============================================================================
-- Migration 040: Loja de Polén — produtos + compras
-- =============================================================================
-- Pacotes de Poléns vendidos via Stripe (price_data ad-hoc). Não gera comissão
-- de afiliado. Sem reembolso (refunded_at reservado para casos manuais via DB).

CREATE TABLE IF NOT EXISTS public.polen_products (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  description         TEXT,
  image_url           TEXT,
  price_cents         INTEGER NOT NULL CHECK (price_cents > 0),
  polens_amount       INTEGER NOT NULL CHECK (polens_amount > 0),
  bonus_polens        INTEGER NOT NULL DEFAULT 0 CHECK (bonus_polens >= 0),
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_polen_products_active_order
  ON public.polen_products (is_active, sort_order);

CREATE TABLE IF NOT EXISTS public.polen_purchases (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  product_id               UUID NOT NULL REFERENCES public.polen_products(id) ON DELETE RESTRICT,
  status                   TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','paid','failed','expired')),
  amount_cents             INTEGER NOT NULL CHECK (amount_cents > 0),
  polens_credited          INTEGER NOT NULL DEFAULT 0 CHECK (polens_credited >= 0),
  stripe_session_id        TEXT,
  stripe_payment_intent    TEXT,
  paid_at                  TIMESTAMPTZ,
  refunded_at              TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_polen_purchases_stripe_session
  ON public.polen_purchases (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_polen_purchases_user
  ON public.polen_purchases (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_polen_purchases_product
  ON public.polen_purchases (product_id, status);

-- Adiciona 'earn_purchase_stripe' ao enum check de polen_transactions.type.
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
      'admin_adjustment',
      'refund',
      'reversal'
    )
  );
