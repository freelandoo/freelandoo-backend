-- =============================================================================
-- Migration 461 — Freelandoo Ads ("Impulsionar"), 2026-11-15
-- =============================================================================
-- Inspirado no Meta Ads / Google Ads, muito mais simples: UMA campanha impulsiona
-- UM post do próprio autor. Três escolhas:
--   objetivo  views (mais gente vendo) | profile (visitas ao perfil) | whatsapp
--   onde      cidade → região → estado → Brasil, a partir do lugar CONGELADO do
--             post (mig 328: reach_city_key / reach_region_id / reach_uf).
--             Cada degrau custa mais por mil visualizações (CPM).
--   quanto    orçamento total + dias. Meta de visualizações = orçamento / CPM × 1000.
-- Paga adiantado (Mercado Pago, em reais). O que não for entregue quando a
-- campanha acaba (prazo, cancelada, post fora da régua) vira CRÉDITO de
-- anúncio (tb_ads_credit), usado primeiro na próxima — sem estorno manual.
--
-- Entrega: o post entra no feed de quem está na área (só logados, adultos),
-- no máximo 1 a cada `slot_every` posts, `freq_cap_day` vezes por dia por
-- pessoa; a campanha atrasada no ritmo vai antes. Visualização conta quando o
-- card fica na tela (evento do cliente), uma por pessoa por vez, até a meta.
--
-- Fontes de pendência (regra 15): `ads_impulso` em PaymentOpsStorage.SOURCES.
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_ads_settings (
  id                SMALLINT PRIMARY KEY DEFAULT 1,
  cpm_city_cents    INTEGER NOT NULL DEFAULT 600,
  cpm_region_cents  INTEGER NOT NULL DEFAULT 900,
  cpm_state_cents   INTEGER NOT NULL DEFAULT 1400,
  cpm_brasil_cents  INTEGER NOT NULL DEFAULT 2200,
  min_budget_cents  INTEGER NOT NULL DEFAULT 1000,
  max_budget_cents  INTEGER NOT NULL DEFAULT 5000000,
  max_days          INTEGER NOT NULL DEFAULT 30,
  freq_cap_day      INTEGER NOT NULL DEFAULT 3,
  slot_every        INTEGER NOT NULL DEFAULT 6,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tb_ads_settings_one CHECK (id = 1)
);
INSERT INTO public.tb_ads_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.tb_ads_campaign (
  id_campaign        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user            UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  id_portfolio_item  UUID NOT NULL REFERENCES public.tb_profile_portfolio_item(id_portfolio_item) ON DELETE CASCADE,
  objective          TEXT NOT NULL DEFAULT 'views',
  tier               TEXT NOT NULL DEFAULT 'cidade',
  city_key           TEXT NULL,
  city_name          TEXT NULL,
  region_id          INTEGER NULL,
  uf                 VARCHAR(2) NULL,
  budget_cents       INTEGER NOT NULL,
  credit_used_cents  INTEGER NOT NULL DEFAULT 0,
  paid_cents         INTEGER NOT NULL DEFAULT 0,
  cpm_cents          INTEGER NOT NULL,
  goal_impressions   INTEGER NOT NULL,
  days               INTEGER NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending_payment',
  start_at           TIMESTAMPTZ NULL,
  end_at             TIMESTAMPTZ NULL,
  impressions        INTEGER NOT NULL DEFAULT 0,
  reach              INTEGER NOT NULL DEFAULT 0,
  clicks_profile     INTEGER NOT NULL DEFAULT 0,
  clicks_whatsapp    INTEGER NOT NULL DEFAULT 0,
  credited_back_cents INTEGER NOT NULL DEFAULT 0,
  session_id         TEXT NULL,
  provider_ref       TEXT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at           TIMESTAMPTZ NULL,
  ended_reason       TEXT NULL,
  CONSTRAINT tb_ads_campaign_budget_chk CHECK (budget_cents > 0),
  CONSTRAINT tb_ads_campaign_goal_chk CHECK (goal_impressions > 0)
);
ALTER TABLE public.tb_ads_campaign DROP CONSTRAINT IF EXISTS tb_ads_campaign_objective_chk;
ALTER TABLE public.tb_ads_campaign ADD CONSTRAINT tb_ads_campaign_objective_chk CHECK (objective IN ('views', 'profile', 'whatsapp'));
ALTER TABLE public.tb_ads_campaign DROP CONSTRAINT IF EXISTS tb_ads_campaign_tier_chk;
ALTER TABLE public.tb_ads_campaign ADD CONSTRAINT tb_ads_campaign_tier_chk CHECK (tier IN ('cidade', 'regiao', 'estado', 'brasil'));
ALTER TABLE public.tb_ads_campaign DROP CONSTRAINT IF EXISTS tb_ads_campaign_status_chk;
ALTER TABLE public.tb_ads_campaign ADD CONSTRAINT tb_ads_campaign_status_chk
  CHECK (status IN ('pending_payment', 'active', 'paused', 'completed', 'canceled', 'expired', 'refunded', 'rejected'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_ads_campaign_session ON public.tb_ads_campaign (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ads_campaign_live ON public.tb_ads_campaign (tier, uf, region_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_ads_campaign_owner ON public.tb_ads_campaign (id_user, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ads_campaign_ref ON public.tb_ads_campaign (provider_ref) WHERE provider_ref IS NOT NULL;

-- Quem viu (alcance único + limite por dia). Pessoa = conta logada.
CREATE TABLE IF NOT EXISTS public.tb_ads_reach (
  id_campaign  UUID NOT NULL REFERENCES public.tb_ads_campaign(id_campaign) ON DELETE CASCADE,
  id_user      UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  day          DATE NOT NULL DEFAULT CURRENT_DATE,
  day_count    INTEGER NOT NULL DEFAULT 0,
  total        INTEGER NOT NULL DEFAULT 0,
  first_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  clicked      BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (id_campaign, id_user)
);

-- Série diária do painel.
CREATE TABLE IF NOT EXISTS public.tb_ads_daily (
  id_campaign  UUID NOT NULL REFERENCES public.tb_ads_campaign(id_campaign) ON DELETE CASCADE,
  day          DATE NOT NULL,
  impressions  INTEGER NOT NULL DEFAULT 0,
  clicks       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (id_campaign, day)
);

-- Crédito de anúncio: lançamentos +/−; saldo = soma. Um crédito por campanha
-- encerrada (UNIQUE parcial) e um débito por campanha criada.
CREATE TABLE IF NOT EXISTS public.tb_ads_credit (
  id_entry     BIGSERIAL PRIMARY KEY,
  id_user      UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL,
  reason       TEXT NOT NULL,
  id_campaign  UUID NULL REFERENCES public.tb_ads_campaign(id_campaign) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.tb_ads_credit DROP CONSTRAINT IF EXISTS tb_ads_credit_reason_chk;
ALTER TABLE public.tb_ads_credit ADD CONSTRAINT tb_ads_credit_reason_chk CHECK (reason IN ('leftover', 'spend', 'restore', 'admin'));
CREATE UNIQUE INDEX IF NOT EXISTS uq_ads_credit_once ON public.tb_ads_credit (id_campaign, reason) WHERE id_campaign IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ads_credit_user ON public.tb_ads_credit (id_user);
