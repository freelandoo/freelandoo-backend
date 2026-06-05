-- =============================================================================
-- Migration 120: Proteção de Pagamento — caso de proteção + provas de fulfillment
-- =============================================================================
-- Âncora 1:1 por transação protegida (produto da Loja ou serviço de Booking).
-- O relógio do repasse passa a partir da PROVA de fulfillment, não do pagamento:
--   • produto  → lojista anexa foto da postagem (+ rastreio ME) → dispute_window
--   • serviço  → prestador anexa foto de chegada E o cliente confirma → dispute_window
-- Depois: 7 dias de janela de disputa → silêncio = clear → arma o ledger (+8d holdback).
--
-- domain ∈ ('product','booking'); ref_id = id_order / id_booking (ambos BIGSERIAL).
-- Idempotente: CREATE TABLE IF NOT EXISTS + backfill ON CONFLICT DO NOTHING.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_protection_case (
  id                   BIGSERIAL    PRIMARY KEY,
  domain               VARCHAR(20)  NOT NULL CHECK (domain IN ('product','booking')),
  ref_id               BIGINT       NOT NULL,
  state                VARCHAR(30)  NOT NULL DEFAULT 'awaiting_fulfillment'
                       CHECK (state IN ('awaiting_fulfillment','dispute_window','clear','disputed','refunded')),
  proof_at             TIMESTAMPTZ,
  window_ends_at       TIMESTAMPTZ,
  cleared_at           TIMESTAMPTZ,
  client_confirmed_at  TIMESTAMPTZ,
  current_dispute_id   BIGINT,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (domain, ref_id)
);

CREATE INDEX IF NOT EXISTS idx_protection_case_window
  ON public.tb_protection_case (window_ends_at)
  WHERE state = 'dispute_window';

CREATE INDEX IF NOT EXISTS idx_protection_case_state
  ON public.tb_protection_case (state);

CREATE TABLE IF NOT EXISTS public.tb_fulfillment_proof (
  id                   BIGSERIAL    PRIMARY KEY,
  protection_case_id   BIGINT       NOT NULL REFERENCES public.tb_protection_case(id) ON DELETE CASCADE,
  kind                 VARCHAR(20)  NOT NULL CHECK (kind IN ('shipment','arrival','completion')),
  photo_url            TEXT,
  tracking_code        VARCHAR(120),
  created_by_user_id   UUID         REFERENCES public.tb_user(id_user),
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fulfillment_proof_case
  ON public.tb_fulfillment_proof (protection_case_id, created_at);

-- -----------------------------------------------------------------------------
-- Backfill: tudo que JÁ está pago/confirmado entra como 'clear' (não estraga
-- repasses em andamento — o gating novo só muda pedidos/bookings futuros).
-- -----------------------------------------------------------------------------
INSERT INTO public.tb_protection_case (domain, ref_id, state, cleared_at, proof_at)
SELECT 'product', o.id_order, 'clear', NOW(), o.paid_at
  FROM public.tb_profile_product_order o
 WHERE o.status IN ('paid','shipped','delivered')
ON CONFLICT (domain, ref_id) DO NOTHING;

INSERT INTO public.tb_protection_case (domain, ref_id, state, cleared_at, proof_at)
SELECT 'booking', b.id, 'clear', NOW(), b.confirmed_at
  FROM public.tb_profile_bookings b
 WHERE b.payment_status = 'paid' AND b.status IN ('confirmed','completed')
ON CONFLICT (domain, ref_id) DO NOTHING;
