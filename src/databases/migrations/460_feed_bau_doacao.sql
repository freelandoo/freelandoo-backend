-- =============================================================================
-- Migration 460 — Baú de DOAÇÃO (Feed Interativo, pedido do Alex 2026-11-15)
-- =============================================================================
-- Alguém COMPRA um baú com o valor que quiser (R$ 1 a R$ 1 milhão) e escolhe só
-- a REGIÃO onde ele vai abrir (UF + região opcional do tb_region). O baú cai no
-- feed de UMA pessoa sorteada daquela região. Quem recebe não paga nada e não
-- esperava nada — é doação, não loot box: ninguém compra a chance de ganhar.
--
-- Dinheiro (fonte única das taxas = tb_feed_bau_settings, em pontos-base):
--   doação:  bruto − 5% Freelandoo − tarifa real do Mercado Pago (sai de quem
--            recebe, regra de pagamentos; apurada por getChargeFee, null ≠ 0)
--   saque:   − 5% Freelandoo sobre o que sobrou
--   o líquido vai para Recebimentos com holdback (8 dias) e segue o ciclo de
--   repasse de sempre: aguardando → aprovado → pago (admin) | revertido | devido.
--
-- tb_feed_bau_donation  o baú comprado; estados:
--   pending_payment  checkout aberto
--   paid             pago, esperando cair para alguém
--   assigned         caiu no feed de alguém (tb_feed_drop), ainda fechado
--   opened           aberto: virou repasse
--   expired          checkout nunca pago
--   refunded         estornado (repasse revertido, ou 'devido' se já pago)
-- tb_feed_bau_skip      quem já teve o baú e não abriu (não cai de novo nele)
-- tb_feed_bau_payout    o repasse de quem abriu
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_feed_bau_settings (
  id                  SMALLINT PRIMARY KEY DEFAULT 1,
  donation_fee_bps    INTEGER NOT NULL DEFAULT 500,
  withdraw_fee_bps    INTEGER NOT NULL DEFAULT 500,
  min_cents           INTEGER NOT NULL DEFAULT 100,
  max_cents           BIGINT  NOT NULL DEFAULT 100000000,
  holdback_days       INTEGER NOT NULL DEFAULT 8,
  -- Sem ninguém na região: depois de N dias vale o estado inteiro; depois de
  -- 2N, o Brasil inteiro (o baú nunca fica parado para sempre).
  widen_days          INTEGER NOT NULL DEFAULT 7,
  -- Caiu para alguém e não foi aberto em N dias: volta para o sorteio.
  claim_days          INTEGER NOT NULL DEFAULT 3,
  -- Chance de cair a cada abertura do feed (o "aleatório").
  drop_chance_pct     INTEGER NOT NULL DEFAULT 35,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tb_feed_bau_settings_one CHECK (id = 1)
);
INSERT INTO public.tb_feed_bau_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.tb_feed_bau_donation (
  id_bau               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_donor             UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE RESTRICT,
  amount_cents         BIGINT NOT NULL,
  uf                   CHAR(2) NOT NULL,
  id_region            INTEGER NULL REFERENCES public.tb_region(id_region) ON DELETE SET NULL,
  message              TEXT NULL,
  anonymous            BOOLEAN NOT NULL DEFAULT FALSE,
  status               TEXT NOT NULL DEFAULT 'pending_payment',
  session_id           TEXT NULL,
  provider_ref         TEXT NULL,
  processor_fee_cents  BIGINT NULL,
  id_receiver          UUID NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  id_drop              UUID NULL REFERENCES public.tb_feed_drop(id_drop) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at              TIMESTAMPTZ NULL,
  assigned_at          TIMESTAMPTZ NULL,
  opened_at            TIMESTAMPTZ NULL,
  refunded_at          TIMESTAMPTZ NULL,
  CONSTRAINT tb_feed_bau_amount_chk CHECK (amount_cents >= 100 AND amount_cents <= 100000000)
);
ALTER TABLE public.tb_feed_bau_donation DROP CONSTRAINT IF EXISTS tb_feed_bau_status_chk;
ALTER TABLE public.tb_feed_bau_donation
  ADD CONSTRAINT tb_feed_bau_status_chk
  CHECK (status IN ('pending_payment', 'paid', 'assigned', 'opened', 'expired', 'refunded'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_feed_bau_session ON public.tb_feed_bau_donation (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_feed_bau_pool ON public.tb_feed_bau_donation (uf, id_region, paid_at) WHERE status = 'paid';
CREATE INDEX IF NOT EXISTS idx_feed_bau_assigned ON public.tb_feed_bau_donation (assigned_at) WHERE status = 'assigned';
CREATE INDEX IF NOT EXISTS idx_feed_bau_donor ON public.tb_feed_bau_donation (id_donor, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feed_bau_receiver ON public.tb_feed_bau_donation (id_receiver, assigned_at DESC);
CREATE INDEX IF NOT EXISTS idx_feed_bau_provider_ref ON public.tb_feed_bau_donation (provider_ref) WHERE provider_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.tb_feed_bau_skip (
  id_bau    UUID NOT NULL REFERENCES public.tb_feed_bau_donation(id_bau) ON DELETE CASCADE,
  id_user   UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_bau, id_user)
);

CREATE TABLE IF NOT EXISTS public.tb_feed_bau_payout (
  id_payout            SERIAL PRIMARY KEY,
  id_bau               UUID NOT NULL UNIQUE REFERENCES public.tb_feed_bau_donation(id_bau) ON DELETE RESTRICT,
  id_receiver_user     UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE RESTRICT,
  gross_cents          BIGINT NOT NULL,
  platform_fee_cents   BIGINT NOT NULL,
  processor_fee_cents  BIGINT NOT NULL DEFAULT 0,
  withdraw_fee_cents   BIGINT NOT NULL,
  net_cents            BIGINT NOT NULL,
  status               VARCHAR(20) NOT NULL DEFAULT 'aguardando',
  available_at         TIMESTAMPTZ NOT NULL,
  approved_at          TIMESTAMPTZ NULL,
  paid_out_at          TIMESTAMPTZ NULL,
  paid_out_note        TEXT NULL,
  reverted_at          TIMESTAMPTZ NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tb_feed_bau_payout_net_chk CHECK (net_cents >= 0)
);
ALTER TABLE public.tb_feed_bau_payout DROP CONSTRAINT IF EXISTS tb_feed_bau_payout_status_check;
ALTER TABLE public.tb_feed_bau_payout ADD CONSTRAINT tb_feed_bau_payout_status_check
  CHECK (status IN ('aguardando', 'aprovado', 'pago', 'revertido', 'devido'));
CREATE INDEX IF NOT EXISTS idx_feed_bau_payout_owner ON public.tb_feed_bau_payout (id_receiver_user, status, available_at);
CREATE INDEX IF NOT EXISTS idx_feed_bau_payout_due ON public.tb_feed_bau_payout (status, available_at);
