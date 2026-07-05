-- =============================================================================
-- Migration 174: Bolsa Patrocínio (campanha irmã da Vaquinha)
-- tb_vaquinha ganha kind ('vaquinha' | 'bolsa'). A vaquinha segue como está
-- (doação one-time + prazo). A bolsa NÃO tem validade (deadline NULL) e os
-- patrocinadores pagam RECORRENTE mensal (Stripe subscription). Cada fatura
-- paga vira uma linha em tb_vaquinha_donation (idempotente por invoice id),
-- reusando o payout com holdback, a lista de apoiadores e o contador.
-- Idempotente.
-- =============================================================================

-- ─── 1. kind + deadline opcional na campanha ────────────────────────────────
ALTER TABLE public.tb_vaquinha
  ADD COLUMN IF NOT EXISTS kind VARCHAR(10) NOT NULL DEFAULT 'vaquinha';

ALTER TABLE public.tb_vaquinha DROP CONSTRAINT IF EXISTS chk_vaquinha_kind;
ALTER TABLE public.tb_vaquinha ADD CONSTRAINT chk_vaquinha_kind
  CHECK (kind IN ('vaquinha','bolsa'));

-- Bolsa não tem prazo.
ALTER TABLE public.tb_vaquinha ALTER COLUMN deadline DROP NOT NULL;

ALTER TABLE public.tb_vaquinha DROP CONSTRAINT IF EXISTS chk_vaquinha_deadline_by_kind;
ALTER TABLE public.tb_vaquinha ADD CONSTRAINT chk_vaquinha_deadline_by_kind
  CHECK (kind <> 'vaquinha' OR deadline IS NOT NULL);

-- ─── 2. Patrocínio recorrente (Stripe subscription mensal) ──────────────────
CREATE TABLE IF NOT EXISTS public.tb_vaquinha_sponsorship (
  id_sponsorship         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_vaquinha            UUID         NOT NULL REFERENCES public.tb_vaquinha(id_vaquinha) ON DELETE CASCADE,
  id_sponsor_user        UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  sponsor_name           TEXT,
  monthly_cents          INT          NOT NULL CHECK (monthly_cents > 0),
  status                 VARCHAR(16)  NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','active','past_due','canceled','expired')),
  stripe_session_id      TEXT         NULL,
  stripe_subscription_id TEXT         NULL,
  stripe_customer_id     TEXT         NULL,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  activated_at           TIMESTAMPTZ  NULL,
  canceled_at            TIMESTAMPTZ  NULL,
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_vaquinha_sponsorship_session
  ON public.tb_vaquinha_sponsorship (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_vaquinha_sponsorship_subscription
  ON public.tb_vaquinha_sponsorship (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

-- No máximo UM patrocínio "vivo" por (bolsa, user).
CREATE UNIQUE INDEX IF NOT EXISTS ux_vaquinha_sponsorship_live
  ON public.tb_vaquinha_sponsorship (id_vaquinha, id_sponsor_user)
  WHERE status IN ('pending','active','past_due');

CREATE INDEX IF NOT EXISTS idx_vaquinha_sponsorship_v
  ON public.tb_vaquinha_sponsorship (id_vaquinha, status);

-- ─── 3. Fatura mensal reusa tb_vaquinha_donation ────────────────────────────
ALTER TABLE public.tb_vaquinha_donation
  ADD COLUMN IF NOT EXISTS id_sponsorship UUID NULL
    REFERENCES public.tb_vaquinha_sponsorship(id_sponsorship) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stripe_invoice_id TEXT NULL;

-- Idempotência por fatura (invoice.paid pode chegar 2x).
CREATE UNIQUE INDEX IF NOT EXISTS ux_vaquinha_donation_invoice
  ON public.tb_vaquinha_donation (stripe_invoice_id)
  WHERE stripe_invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vaquinha_donation_sponsorship
  ON public.tb_vaquinha_donation (id_sponsorship)
  WHERE id_sponsorship IS NOT NULL;
