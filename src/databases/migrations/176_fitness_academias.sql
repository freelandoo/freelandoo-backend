-- =============================================================================
-- Migration 176: Fitness & Academias — Fase 1 (fundação)
-- Academia cadastra URL+token da API do software dela (Gym Provider API, pull);
-- Freelandoo espelha eventos de catraca e pagamentos (idempotente por
-- external_id) e vincula usuários por CPF. Feature separada de comunidade.
-- Spec: docs/superpowers/specs/2026-07-07-fitness-academias-design.md
-- Idempotente.
-- =============================================================================

-- ─── 1. Academia ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_academy (
  id_academy       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_owner_user    UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  nome             TEXT         NOT NULL,
  slug             TEXT         NOT NULL UNIQUE,
  descricao        TEXT         NULL,
  cidade           TEXT         NULL,
  avatar_url       TEXT         NULL,
  cover_url        TEXT         NULL,
  api_base_url     TEXT         NOT NULL,
  api_token_enc    TEXT         NOT NULL,
  sync_status      VARCHAR(16)  NOT NULL DEFAULT 'never'
                     CHECK (sync_status IN ('never','ok','error','auth_error')),
  sync_error       TEXT         NULL,
  events_cursor    TEXT         NULL,
  payments_cursor  TEXT         NULL,
  last_sync_at     TIMESTAMPTZ  NULL,
  is_active        BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_academy_owner ON public.tb_academy (id_owner_user);
CREATE INDEX IF NOT EXISTS idx_academy_active ON public.tb_academy (is_active, cidade);

-- ─── 2. Vínculo aluno↔academia por CPF ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_academy_member (
  id_member          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_academy         UUID         NOT NULL REFERENCES public.tb_academy(id_academy) ON DELETE CASCADE,
  id_user            UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  cpf                VARCHAR(11)  NOT NULL,
  member_name        TEXT         NULL,
  membership_status  VARCHAR(16)  NOT NULL DEFAULT 'pending'
                       CHECK (membership_status IN ('active','overdue','canceled','expired','pending')),
  plan_name          TEXT         NULL,
  enrolled_at        TIMESTAMPTZ  NULL,
  expires_at         TIMESTAMPTZ  NULL,
  linked_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_refreshed_at  TIMESTAMPTZ  NULL,
  CONSTRAINT ux_academy_member_user UNIQUE (id_academy, id_user),
  CONSTRAINT ux_academy_member_cpf  UNIQUE (id_academy, cpf)
);

CREATE INDEX IF NOT EXISTS idx_academy_member_user ON public.tb_academy_member (id_user);

-- ─── 3. Professores (promovidos pelo dono; precisam ser membros) ─────────────
CREATE TABLE IF NOT EXISTS public.tb_academy_professor (
  id_academy  UUID         NOT NULL REFERENCES public.tb_academy(id_academy) ON DELETE CASCADE,
  id_user     UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  granted_by  UUID         NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_academy, id_user)
);

-- ─── 4. Espelho: eventos de catraca (frequência) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_academy_access_event (
  id_event     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_academy   UUID         NOT NULL REFERENCES public.tb_academy(id_academy) ON DELETE CASCADE,
  id_member    UUID         NOT NULL REFERENCES public.tb_academy_member(id_member) ON DELETE CASCADE,
  external_id  TEXT         NOT NULL,
  occurred_at  TIMESTAMPTZ  NOT NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT ux_academy_event_external UNIQUE (id_academy, external_id)
);

CREATE INDEX IF NOT EXISTS idx_academy_event_member
  ON public.tb_academy_access_event (id_member, occurred_at);

-- ─── 5. Espelho: pagamentos (mensalidades) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_academy_payment (
  id_payment   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_academy   UUID         NOT NULL REFERENCES public.tb_academy(id_academy) ON DELETE CASCADE,
  id_member    UUID         NOT NULL REFERENCES public.tb_academy_member(id_member) ON DELETE CASCADE,
  external_id  TEXT         NOT NULL,
  amount_cents INT          NOT NULL,
  due_date     TIMESTAMPTZ  NULL,
  status       VARCHAR(16)  NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','paid','overdue')),
  paid_at      TIMESTAMPTZ  NULL,
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT ux_academy_payment_external UNIQUE (id_academy, external_id)
);

CREATE INDEX IF NOT EXISTS idx_academy_payment_member
  ON public.tb_academy_payment (id_member, due_date DESC);

-- ─── 6. Feature flag — nasce DESLIGADA ───────────────────────────────────────
INSERT INTO public.tb_feature_flag (flag_key, label, description, is_enabled)
VALUES (
  'fitness_academias',
  'Fitness & Academias',
  'Academias parceiras (vínculo por CPF via Gym Provider API), painel fitness (calorias/água/treinos/frequência) e página social da academia. Desligar esconde as superfícies sem apagar dados.',
  FALSE
)
ON CONFLICT (flag_key) DO NOTHING;
