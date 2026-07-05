-- =============================================================================
-- Migration 175: Atendimento IA (venda do bot por assinatura mensal em planos)
-- Planos com preço + limite de tokens de LLM por ciclo. Assinatura Stripe
-- (subscription mensal price_data ad-hoc) com 1 viva por user. Provisionamento
-- automático push Freelandoo → bot (tokens gerenciados cunhados server-side,
-- retry com backoff). Spec: docs/superpowers/specs/2026-07-05-atendimento-ia-design.md
-- Idempotente.
-- =============================================================================

-- ─── 1. Planos (admin CRUD) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_atendimento_ia_plan (
  id_plan             BIGSERIAL    PRIMARY KEY,
  name                TEXT         NOT NULL,
  description         TEXT         NULL,
  monthly_cents       INT          NOT NULL CHECK (monthly_cents > 0),
  token_limit_monthly BIGINT       NOT NULL CHECK (token_limit_monthly > 0),
  sort_order          INT          NOT NULL DEFAULT 0,
  is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Seed de exemplos úteis (edita no painel admin). Idempotente por name.
INSERT INTO public.tb_atendimento_ia_plan (name, description, monthly_cents, token_limit_monthly, sort_order)
SELECT 'Básico', 'Para começar: o bot responde suas conversas sabendo seus serviços e preços.', 2990, 300000, 1
WHERE NOT EXISTS (SELECT 1 FROM public.tb_atendimento_ia_plan WHERE name = 'Básico');

INSERT INTO public.tb_atendimento_ia_plan (name, description, monthly_cents, token_limit_monthly, sort_order)
SELECT 'Profissional', 'Para quem vende todo dia: mais que o triplo de atendimentos por mês.', 5990, 1000000, 2
WHERE NOT EXISTS (SELECT 1 FROM public.tb_atendimento_ia_plan WHERE name = 'Profissional');

INSERT INTO public.tb_atendimento_ia_plan (name, description, monthly_cents, token_limit_monthly, sort_order)
SELECT 'Turbo', 'Volume alto de mensagens: o bot dá conta do movimento inteiro.', 9990, 2500000, 3
WHERE NOT EXISTS (SELECT 1 FROM public.tb_atendimento_ia_plan WHERE name = 'Turbo');

-- ─── 2. Assinatura (1 viva por user) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_atendimento_ia_sub (
  id_sub                     BIGSERIAL    PRIMARY KEY,
  id_user                    UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  id_plan                    BIGINT       NOT NULL REFERENCES public.tb_atendimento_ia_plan(id_plan) ON DELETE RESTRICT,
  monthly_cents              INT          NOT NULL CHECK (monthly_cents > 0),
  token_limit_monthly        BIGINT       NOT NULL CHECK (token_limit_monthly > 0),
  status                     VARCHAR(16)  NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending','active','past_due','canceled','expired')),
  stripe_session_id          TEXT         NULL,
  stripe_subscription_id     TEXT         NULL,
  stripe_customer_id         TEXT         NULL,
  current_period_start       TIMESTAMPTZ  NULL,
  current_period_end         TIMESTAMPTZ  NULL,
  provisioning_status        VARCHAR(16)  NOT NULL DEFAULT 'pending'
                               CHECK (provisioning_status IN ('pending','provisioned','failed','deprovisioned')),
  provision_attempts         INT          NOT NULL DEFAULT 0,
  next_provision_attempt_at  TIMESTAMPTZ  NULL,
  provision_last_error       TEXT         NULL,
  id_connection_atendimento  UUID         NULL REFERENCES public.tb_api_connection(id_connection) ON DELETE SET NULL,
  id_connection_data         UUID         NULL REFERENCES public.tb_api_connection(id_connection) ON DELETE SET NULL,
  config                     JSONB        NOT NULL DEFAULT '{"paused":false,"answer_dm":true,"answer_os":true,"extra_instructions":""}',
  created_at                 TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  activated_at               TIMESTAMPTZ  NULL,
  canceled_at                TIMESTAMPTZ  NULL,
  updated_at                 TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_atendimento_ia_sub_live
  ON public.tb_atendimento_ia_sub (id_user)
  WHERE status IN ('pending','active','past_due');

CREATE UNIQUE INDEX IF NOT EXISTS ux_atendimento_ia_sub_session
  ON public.tb_atendimento_ia_sub (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_atendimento_ia_sub_subscription
  ON public.tb_atendimento_ia_sub (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

-- Sweeper de provisionamento: acha rápido o que está devendo push.
CREATE INDEX IF NOT EXISTS idx_atendimento_ia_sub_provision_due
  ON public.tb_atendimento_ia_sub (next_provision_attempt_at)
  WHERE status IN ('active','past_due') AND provisioning_status IN ('pending','failed');

-- ─── 3. Conexões gerenciadas (tokens cunhados pelo sistema) ──────────────────
ALTER TABLE public.tb_api_connection
  ADD COLUMN IF NOT EXISTS managed_by TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_api_connection_managed
  ON public.tb_api_connection (id_user, managed_by)
  WHERE managed_by IS NOT NULL;

-- ─── 4. Feature flag — nasce DESLIGADA (depende do bot estar no ar) ──────────
INSERT INTO public.tb_feature_flag (flag_key, label, description, is_enabled)
VALUES (
  'atendimento_ia_venda',
  'Atendimento IA (venda)',
  'Venda do bot de Atendimento IA por assinatura mensal (planos com limite de tokens). Desligar esconde a compra e a página nova; assinantes existentes continuam sendo cobrados e atendidos (kill-switch de VENDA, não do serviço).',
  FALSE
)
ON CONFLICT (flag_key) DO NOTHING;
