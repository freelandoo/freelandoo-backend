-- =============================================================================
-- Migration 064: Profile Product Orders + Seller Balance
-- =============================================================================
-- Pedidos da Loja de produtos (mig 063) e saldo do vendedor com holdback de
-- 8 dias (mesmo padrão da mig 031 — janela CDC para reembolso). Sem Stripe
-- Connect: o dinheiro cai na conta Stripe da plataforma; payout manual ao
-- vendedor após `available_at` (>= 8 dias). `charge.refunded` reverte.
-- =============================================================================

-- ─── Pedido ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_profile_product_order (
  id_order                  BIGSERIAL    PRIMARY KEY,
  id_buyer_user             UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE RESTRICT,
  id_profile_product        BIGINT       NOT NULL REFERENCES public.tb_profile_product(id_profile_product) ON DELETE RESTRICT,
  id_seller_profile         UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE RESTRICT,
  id_seller_user            UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE RESTRICT,
  quantity                  INT          NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_cents          INT          NOT NULL CHECK (unit_price_cents >= 0),
  shipping_cents            INT          NOT NULL DEFAULT 0 CHECK (shipping_cents >= 0),
  total_cents               INT          NOT NULL CHECK (total_cents >= 0),
  shipping_service_id       TEXT,
  shipping_service_name     TEXT,
  shipping_carrier          TEXT,
  destination_zipcode       VARCHAR(8)   NOT NULL,
  destination_full_address  JSONB,
  buyer_name                TEXT,
  buyer_email               TEXT,
  buyer_whatsapp            TEXT,
  stripe_session_id         TEXT         UNIQUE,
  stripe_payment_intent_id  TEXT,
  stripe_charge_id          TEXT,
  status                    VARCHAR(20)  NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','paid','shipped','delivered','canceled','refunded')),
  tracking_code             TEXT,
  paid_at                   TIMESTAMPTZ,
  shipped_at                TIMESTAMPTZ,
  delivered_at              TIMESTAMPTZ,
  canceled_at               TIMESTAMPTZ,
  refunded_at               TIMESTAMPTZ,
  created_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pp_order_buyer
  ON public.tb_profile_product_order (id_buyer_user, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pp_order_seller
  ON public.tb_profile_product_order (id_seller_user, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pp_order_status
  ON public.tb_profile_product_order (status);

CREATE INDEX IF NOT EXISTS idx_pp_order_product
  ON public.tb_profile_product_order (id_profile_product);

-- ─── Saldo do vendedor (1 entrada por pedido) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_seller_balance (
  id_balance         BIGSERIAL    PRIMARY KEY,
  id_seller_user     UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE RESTRICT,
  id_seller_profile  UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE RESTRICT,
  id_order           BIGINT       NOT NULL UNIQUE REFERENCES public.tb_profile_product_order(id_order) ON DELETE CASCADE,
  gross_cents        INT          NOT NULL CHECK (gross_cents >= 0),
  platform_fee_cents INT          NOT NULL DEFAULT 0 CHECK (platform_fee_cents >= 0),
  shipping_cents     INT          NOT NULL DEFAULT 0 CHECK (shipping_cents >= 0),
  net_cents          INT          NOT NULL CHECK (net_cents >= 0),
  status             VARCHAR(20)  NOT NULL DEFAULT 'aguardando'
                       CHECK (status IN ('aguardando','aprovado','pago','revertido')),
  available_at       TIMESTAMPTZ  NOT NULL,
  approved_at        TIMESTAMPTZ,
  paid_out_at        TIMESTAMPTZ,
  paid_out_note      TEXT,
  reverted_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seller_balance_seller
  ON public.tb_seller_balance (id_seller_user, status, available_at);

CREATE INDEX IF NOT EXISTS idx_seller_balance_release
  ON public.tb_seller_balance (status, available_at);
