-- =============================================================================
-- Migration 170: Vaquinha (campanha de doação)
-- =============================================================================
-- Cada user pode ter UMA vaquinha ativa por vez. Página pública com contador +
-- meta obrigatória + prazo (máx 90 dias). Doações via Stripe caem no Saldo do
-- criador (holdback 8 dias, espelha tb_booking_payout), menos a taxa da
-- plataforma (vaquinha_settings.platform_fee_percent). Posts (texto/post/bee)
-- ficam SÓ na página da vaquinha (não entram no feed/perfil normal).
-- Idempotente.
-- =============================================================================

-- ─── Campanha ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_vaquinha (
  id_vaquinha   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user       UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  title         TEXT         NOT NULL,
  slug          TEXT         NOT NULL UNIQUE,
  bio           TEXT,
  cover_url     TEXT,
  goal_cents    BIGINT       NOT NULL CHECK (goal_cents > 0),
  raised_cents  BIGINT       NOT NULL DEFAULT 0 CHECK (raised_cents >= 0),
  donors_count  INT          NOT NULL DEFAULT 0 CHECK (donors_count >= 0),
  deadline      TIMESTAMPTZ  NOT NULL,
  status        VARCHAR(20)  NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','ended','canceled')),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  ended_at      TIMESTAMPTZ
);

-- No máximo UMA vaquinha ativa por user.
CREATE UNIQUE INDEX IF NOT EXISTS ux_vaquinha_one_active_per_user
  ON public.tb_vaquinha (id_user) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_vaquinha_status_deadline
  ON public.tb_vaquinha (status, deadline);

-- ─── Doações ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_vaquinha_donation (
  id_donation              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_vaquinha              UUID         NOT NULL REFERENCES public.tb_vaquinha(id_vaquinha) ON DELETE CASCADE,
  id_donor_user            UUID         NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  donor_name               TEXT,
  message                  TEXT,
  gross_cents              BIGINT       NOT NULL CHECK (gross_cents > 0),
  platform_fee_cents       BIGINT       NOT NULL DEFAULT 0 CHECK (platform_fee_cents >= 0),
  net_cents                BIGINT       NOT NULL CHECK (net_cents >= 0),
  status                   VARCHAR(20)  NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','paid','refunded')),
  stripe_session_id        TEXT         UNIQUE,
  stripe_payment_intent_id TEXT,
  stripe_charge_id         TEXT,
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  paid_at                  TIMESTAMPTZ,
  refunded_at              TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_vaquinha_donation_v
  ON public.tb_vaquinha_donation (id_vaquinha, status, paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_vaquinha_donation_charge
  ON public.tb_vaquinha_donation (stripe_charge_id);
CREATE INDEX IF NOT EXISTS idx_vaquinha_donation_pi
  ON public.tb_vaquinha_donation (stripe_payment_intent_id);

-- ─── Saldo do criador (holdback, espelha tb_booking_payout) ──────────────────
CREATE TABLE IF NOT EXISTS public.tb_vaquinha_payout (
  id_payout          BIGSERIAL    PRIMARY KEY,
  id_donation        UUID         NOT NULL UNIQUE REFERENCES public.tb_vaquinha_donation(id_donation) ON DELETE CASCADE,
  id_vaquinha        UUID         NOT NULL REFERENCES public.tb_vaquinha(id_vaquinha) ON DELETE CASCADE,
  id_owner_user      UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE RESTRICT,
  gross_cents        BIGINT       NOT NULL,
  platform_fee_cents BIGINT       NOT NULL DEFAULT 0,
  net_cents          BIGINT       NOT NULL CHECK (net_cents >= 0),
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
CREATE INDEX IF NOT EXISTS idx_vaquinha_payout_owner
  ON public.tb_vaquinha_payout (id_owner_user, status, available_at);
CREATE INDEX IF NOT EXISTS idx_vaquinha_payout_release
  ON public.tb_vaquinha_payout (status, available_at);

-- ─── Posts (só na página da vaquinha) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_vaquinha_post (
  id_post       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_vaquinha   UUID         NOT NULL REFERENCES public.tb_vaquinha(id_vaquinha) ON DELETE CASCADE,
  id_user       UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  kind          VARCHAR(10)  NOT NULL DEFAULT 'post' CHECK (kind IN ('post','bee','text')),
  caption       TEXT,
  media_url     TEXT,
  thumbnail_url TEXT,
  media_type    VARCHAR(10)  CHECK (media_type IN ('image','video')),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_vaquinha_post_v
  ON public.tb_vaquinha_post (id_vaquinha, created_at DESC) WHERE deleted_at IS NULL;

-- ─── Configuração (taxa da plataforma) — singleton id=1 ──────────────────────
CREATE TABLE IF NOT EXISTS public.vaquinha_settings (
  id                   INT          PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  platform_fee_percent NUMERIC(5,2) NOT NULL DEFAULT 10.00
                         CHECK (platform_fee_percent >= 0 AND platform_fee_percent <= 100),
  max_days             INT          NOT NULL DEFAULT 90 CHECK (max_days > 0),
  min_donation_cents   INT          NOT NULL DEFAULT 500 CHECK (min_donation_cents > 0),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_by           UUID         NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL
);
INSERT INTO public.vaquinha_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ─── Feature flag (Painel de Controle) ───────────────────────────────────────
INSERT INTO public.tb_feature_flag (flag_key, label, description, is_enabled)
VALUES (
  'vaquinha',
  'Vaquinhas',
  'Campanhas de doação (vaquinha): página pública com contador/meta/prazo, posts próprios e doação via Stripe (cai no Saldo do criador). Desligar esconde a criação e as páginas e bloqueia novas doações.'
)
ON CONFLICT (flag_key) DO NOTHING;
