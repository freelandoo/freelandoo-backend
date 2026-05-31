-- =============================================================================
-- Migration 110: Casa Views — Conveniência Views (lojinha por participante)
-- =============================================================================
-- Tabela enxuta SEM frete: produto digital/simbólico por participante. Checkout
-- Stripe single-item via price_data ad-hoc (sem Product/Price no dashboard, sem
-- Connect — o dinheiro cai na conta do Alex, igual à Loja). Sem endereço, sem
-- Melhor Envio, sem seller balance. Idempotência do webhook via UNIQUE em
-- stripe_session_id.
-- Idempotente: CREATE TABLE IF NOT EXISTS.
-- =============================================================================

-- ─── Produto da lojinha ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.casa_participant_product (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_participant  UUID         NOT NULL REFERENCES public.casa_participant(id) ON DELETE CASCADE,
  name            VARCHAR(160) NOT NULL,
  description     TEXT,
  image_url       TEXT,
  price_cents     BIGINT       NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  stock           INT          CHECK (stock IS NULL OR stock >= 0), -- NULL = ilimitado
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order      INT          NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_casa_product_participant
  ON public.casa_participant_product (id_participant, is_active, sort_order);

-- ─── Pedido (one-time Stripe) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.casa_participant_product_order (
  id                      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_product              UUID         NOT NULL REFERENCES public.casa_participant_product(id) ON DELETE RESTRICT,
  id_participant          UUID         NOT NULL REFERENCES public.casa_participant(id) ON DELETE RESTRICT,
  id_user                 UUID         REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  buyer_email             VARCHAR(200),
  product_name            VARCHAR(160) NOT NULL,
  quantity                INT          NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  amount_cents            BIGINT       NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  status                  VARCHAR(20)  NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','paid','canceled','refunded')),
  stripe_session_id       VARCHAR(220) NOT NULL UNIQUE,   -- idempotência do webhook
  stripe_payment_intent   VARCHAR(220),
  stripe_charge_id        VARCHAR(220),
  paid_at                 TIMESTAMPTZ,
  refunded_at             TIMESTAMPTZ,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_casa_order_user
  ON public.casa_participant_product_order (id_user, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_casa_order_participant
  ON public.casa_participant_product_order (id_participant, status);
