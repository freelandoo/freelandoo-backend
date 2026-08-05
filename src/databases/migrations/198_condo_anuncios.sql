-- =============================================================================
-- Migration 198: Anúncios do condomínio (serviços e produtos) + vagas extras
-- O morador anuncia dentro do condomínio: SERVIÇO (faço unha, passeio com cão)
-- ou PRODUTO (bolo, bicicleta). Uma quantidade é GRÁTIS (condo_settings, mig
-- 196); acima disso ele compra "vagas de publicação" — em dinheiro (Stripe,
-- price_data ad-hoc como a Loja de Funções) ou em Poléns.
--
-- Vaga é CRÉDITO por (condomínio, morador, tipo): não é assinatura e não
-- expira. Ao arquivar um anúncio a vaga volta a ficar livre — o que se compra
-- é o direito de manter mais N anúncios ATIVOS ao mesmo tempo.
-- Idempotente.
-- =============================================================================

-- ─── 1. Anúncio ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_condo_listing (
  id_listing  BIGSERIAL     PRIMARY KEY,
  id_condo    UUID          NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_user     UUID          NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  kind        VARCHAR(10)   NOT NULL CHECK (kind IN ('service', 'product')),
  title       VARCHAR(120)  NOT NULL,
  description VARCHAR(2000) NULL,
  price_cents INT           NULL CHECK (price_cents IS NULL OR price_cents >= 0),
  contact     VARCHAR(120)  NULL,
  image_url   TEXT          NULL,
  status      VARCHAR(12)   NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'archived')),
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ   NULL
);

CREATE INDEX IF NOT EXISTS idx_condo_listing_board
  ON public.tb_condo_listing (id_condo, kind, created_at DESC)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_condo_listing_owner
  ON public.tb_condo_listing (id_condo, id_user, kind)
  WHERE status = 'active';

-- ─── 2. Vaga de publicação comprada ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_condo_listing_slot (
  id_slot           BIGSERIAL    PRIMARY KEY,
  id_condo          UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_user           UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  kind              VARCHAR(10)  NOT NULL CHECK (kind IN ('service', 'product')),
  quantity          INT          NOT NULL DEFAULT 1 CHECK (quantity > 0),
  payment_provider  VARCHAR(16)  NOT NULL DEFAULT 'stripe'
                      CHECK (payment_provider IN ('stripe', 'polens', 'admin_grant')),
  amount_cents      INT          NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  amount_polens     INT          NOT NULL DEFAULT 0 CHECK (amount_polens >= 0),
  status            VARCHAR(12)  NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'paid', 'canceled', 'failed', 'refunded')),
  stripe_session_id TEXT         NULL,
  -- Guardado na confirmação: é por ele que o charge.refunded acha a compra.
  stripe_payment_intent_id TEXT  NULL,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  paid_at           TIMESTAMPTZ  NULL,
  refunded_at       TIMESTAMPTZ  NULL
);

-- Coluna adicionada depois em ambiente que já tinha a tabela.
ALTER TABLE public.tb_condo_listing_slot
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_condo_slot_pi
  ON public.tb_condo_listing_slot (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

-- Idempotência do webhook (mesma convenção das outras compras).
CREATE UNIQUE INDEX IF NOT EXISTS ux_condo_slot_session
  ON public.tb_condo_listing_slot (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;

-- Saldo de vagas: soma das linhas pagas e não estornadas.
CREATE INDEX IF NOT EXISTS idx_condo_slot_balance
  ON public.tb_condo_listing_slot (id_condo, id_user, kind)
  WHERE status = 'paid' AND refunded_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_condo_slot_user
  ON public.tb_condo_listing_slot (id_user, created_at DESC);

-- ─── 3. Débito em Poléns (lista completa re-declarada, como na mig 195) ─────
ALTER TABLE public.polen_transactions
  DROP CONSTRAINT IF EXISTS polen_transactions_type_chk;

ALTER TABLE public.polen_transactions
  ADD CONSTRAINT polen_transactions_type_chk CHECK (
    type IN (
      'earn_rewarded_ad', 'earn_purchase_stripe', 'earn_level_up', 'earn_live_gift',
      'earn_community_goal',
      'spend_profile_activation', 'spend_premium_highlight', 'spend_profile_boost',
      'spend_post_boost', 'spend_clan_highlight', 'spend_manifestation', 'spend_premium',
      'spend_live_gift', 'spend_function_purchase', 'spend_condo_listing_slot',
      'admin_adjustment', 'refund', 'reversal'
    )
  );
