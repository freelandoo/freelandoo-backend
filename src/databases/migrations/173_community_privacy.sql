-- =============================================================================
-- Migration 173: Comunidades privadas (mensalidade recorrente)
-- Comunidade ganha chave público/privado. Privada: posts ligados ao feed dela
-- viram EXCLUSIVOS (não aparecem no /feed, bees, perfil público nem /p/) e
-- entrar exige assinatura mensal via Stripe (mode=subscription). Cada fatura
-- paga vira um crédito pro líder (holdback 8 dias, espelha tb_vaquinha_payout),
-- menos a taxa da plataforma (community_settings.platform_fee_percent).
-- Idempotente.
-- =============================================================================

-- ─── 1. Chave de privacidade + preço na própria tb_profile ──────────────────
ALTER TABLE public.tb_profile
  ADD COLUMN IF NOT EXISTS community_privacy       VARCHAR(10) NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS community_monthly_cents INT NULL;

ALTER TABLE public.tb_profile DROP CONSTRAINT IF EXISTS chk_profile_community_privacy;
ALTER TABLE public.tb_profile ADD CONSTRAINT chk_profile_community_privacy
  CHECK (community_privacy IN ('public','private'));

-- ─── 2. Post exclusivo de comunidade privada ────────────────────────────────
-- Setado quando um post é ligado ao feed de uma comunidade privada; as queries
-- do /feed, bees, grade pública do perfil e /p/ excluem itens com valor aqui.
ALTER TABLE public.tb_profile_portfolio_item
  ADD COLUMN IF NOT EXISTS id_exclusive_community UUID NULL
    REFERENCES public.tb_profile(id_profile) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_portfolio_item_exclusive_community
  ON public.tb_profile_portfolio_item (id_exclusive_community)
  WHERE id_exclusive_community IS NOT NULL;

-- ─── 3. Assinatura de membro (Stripe subscription mensal) ───────────────────
CREATE TABLE IF NOT EXISTS public.tb_community_member_sub (
  id_sub                 BIGSERIAL    PRIMARY KEY,
  id_community_profile   UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_user                UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
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

CREATE UNIQUE INDEX IF NOT EXISTS ux_community_member_sub_session
  ON public.tb_community_member_sub (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_community_member_sub_subscription
  ON public.tb_community_member_sub (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

-- No máximo UMA assinatura "viva" por (comunidade, user).
CREATE UNIQUE INDEX IF NOT EXISTS ux_community_member_sub_live
  ON public.tb_community_member_sub (id_community_profile, id_user)
  WHERE status IN ('pending','active','past_due');

CREATE INDEX IF NOT EXISTS idx_community_member_sub_user
  ON public.tb_community_member_sub (id_user, created_at DESC);

-- ─── 4. Pagamento mensal → Saldo do líder (holdback, espelha vaquinha) ───────
CREATE TABLE IF NOT EXISTS public.tb_community_member_payment (
  id_payment               BIGSERIAL    PRIMARY KEY,
  id_sub                   BIGINT       NOT NULL REFERENCES public.tb_community_member_sub(id_sub) ON DELETE CASCADE,
  id_community_profile     UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_owner_user            UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE RESTRICT,
  gross_cents              BIGINT       NOT NULL CHECK (gross_cents >= 0),
  platform_fee_cents       BIGINT       NOT NULL DEFAULT 0 CHECK (platform_fee_cents >= 0),
  net_cents                BIGINT       NOT NULL CHECK (net_cents >= 0),
  status                   VARCHAR(20)  NOT NULL DEFAULT 'aguardando'
                             CHECK (status IN ('aguardando','aprovado','pago','revertido')),
  stripe_invoice_id        TEXT         NOT NULL,
  stripe_payment_intent_id TEXT         NULL,
  stripe_charge_id         TEXT         NULL,
  available_at             TIMESTAMPTZ  NOT NULL,
  paid_out_at              TIMESTAMPTZ  NULL,
  reverted_at              TIMESTAMPTZ  NULL,
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Idempotência por fatura (invoice.paid pode chegar 2x).
CREATE UNIQUE INDEX IF NOT EXISTS ux_community_member_payment_invoice
  ON public.tb_community_member_payment (stripe_invoice_id);

CREATE INDEX IF NOT EXISTS idx_community_member_payment_owner
  ON public.tb_community_member_payment (id_owner_user, status, available_at);

CREATE INDEX IF NOT EXISTS idx_community_member_payment_charge
  ON public.tb_community_member_payment (stripe_charge_id);

-- ─── 5. Configuração (taxa da plataforma) — singleton id=1 ───────────────────
CREATE TABLE IF NOT EXISTS public.community_settings (
  id                   INT          PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  platform_fee_percent NUMERIC(5,2) NOT NULL DEFAULT 10.00
                         CHECK (platform_fee_percent >= 0 AND platform_fee_percent <= 100),
  min_monthly_cents    INT          NOT NULL DEFAULT 500 CHECK (min_monthly_cents > 0),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_by           UUID         NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL
);
INSERT INTO public.community_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ─── 6. Feature flag (Painel de Controle) ────────────────────────────────────
INSERT INTO public.tb_feature_flag (flag_key, label, description)
VALUES (
  'comunidade_privada',
  'Comunidades privadas',
  'Comunidades com chave privada e mensalidade recorrente (Stripe). Desligar bloqueia trocar a privacidade e novas assinaturas de entrada; comunidades já privadas continuam privadas e as assinaturas existentes continuam sendo cobradas.'
)
ON CONFLICT (flag_key) DO NOTHING;
