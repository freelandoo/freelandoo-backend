-- =============================================================================
-- Migration 296: Acesso Freelandoo a partir do Coliseu (API de parceiro)
-- Spec: coliseu-backend/docs/superpowers/specs/2026-10-20-coliseu-freelandoo-acesso-design.md
--
-- 1. Chave de parceiro por academia (só o hash SHA-256; a chave crua é
--    mostrada UMA vez ao dono). Autentica /partner/v1/*.
-- 2. tb_academy_member.ref_externa — id da pessoa no software da academia.
-- 3. Estado de onboarding da conta criada pela academia
--    ('aguardando_aceite' até o aceite dos termos no modal; 'ativa' depois).
--    NULL = conta comum (não veio de academia) — nada muda para a base atual.
-- 4. tb_user_first_access — token de primeiro acesso (hash, 7 dias, usado_em).
-- 5. tb_academy_member_photo — foto do cadastro na academia, SEPARADA do
--    avatar: só vira foto de perfil se o aluno aceitar no modal.
-- 6. tb_user_consent — registro do aceite (versão dos termos, data, foto).
-- 7. Validade por treino (30/60/90): existentes ficam com 90, novos nascem 60.
-- Idempotente.
-- =============================================================================

-- ─── 1. Chave de parceiro ────────────────────────────────────────────────────
ALTER TABLE public.tb_academy ADD COLUMN IF NOT EXISTS partner_key_hash TEXT NULL;
ALTER TABLE public.tb_academy ADD COLUMN IF NOT EXISTS partner_key_created_at TIMESTAMPTZ NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_academy_partner_key_hash
  ON public.tb_academy (partner_key_hash)
  WHERE partner_key_hash IS NOT NULL;

-- ─── 2. Referência externa do vínculo ────────────────────────────────────────
ALTER TABLE public.tb_academy_member ADD COLUMN IF NOT EXISTS ref_externa TEXT NULL;

-- ─── 3. Estado de onboarding da conta vinda de academia ──────────────────────
ALTER TABLE public.tb_user ADD COLUMN IF NOT EXISTS academy_onboarding_state VARCHAR(20) NULL;
ALTER TABLE public.tb_user ADD COLUMN IF NOT EXISTS academy_onboarding_id_academy UUID NULL;

ALTER TABLE public.tb_user DROP CONSTRAINT IF EXISTS chk_tb_user_academy_onboarding_state;
ALTER TABLE public.tb_user ADD CONSTRAINT chk_tb_user_academy_onboarding_state
  CHECK (academy_onboarding_state IS NULL
         OR academy_onboarding_state IN ('aguardando_aceite', 'ativa'));

ALTER TABLE public.tb_user DROP CONSTRAINT IF EXISTS fk_tb_user_academy_onboarding_academy;
ALTER TABLE public.tb_user ADD CONSTRAINT fk_tb_user_academy_onboarding_academy
  FOREIGN KEY (academy_onboarding_id_academy)
  REFERENCES public.tb_academy(id_academy) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tb_user_academy_onboarding_pending
  ON public.tb_user (id_user)
  WHERE academy_onboarding_state = 'aguardando_aceite';

-- ─── 4. Token de primeiro acesso ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_user_first_access (
  id_first_access UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user         UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  id_academy      UUID         NULL REFERENCES public.tb_academy(id_academy) ON DELETE SET NULL,
  token_hash      TEXT         NOT NULL UNIQUE,
  expira_em       TIMESTAMPTZ  NOT NULL,
  usado_em        TIMESTAMPTZ  NULL,
  criado_em       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_first_access_user
  ON public.tb_user_first_access (id_user);

-- ─── 5. Foto do cadastro na academia (separada do avatar) ────────────────────
CREATE TABLE IF NOT EXISTS public.tb_academy_member_photo (
  id_academy    UUID         NOT NULL REFERENCES public.tb_academy(id_academy) ON DELETE CASCADE,
  id_user       UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  photo_key     TEXT         NOT NULL,
  content_type  VARCHAR(32)  NOT NULL,
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_academy, id_user)
);

-- ─── 6. Aceite dos termos da conta vinda de academia ─────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_user_consent (
  id_consent            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user               UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  id_academy            UUID         NULL REFERENCES public.tb_academy(id_academy) ON DELETE SET NULL,
  versao_termos         VARCHAR(32)  NOT NULL,
  aceito_em             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  foto_academia_aceita  BOOLEAN      NOT NULL DEFAULT FALSE,
  ip                    TEXT         NULL,
  user_agent            TEXT         NULL
);

CREATE INDEX IF NOT EXISTS idx_user_consent_user
  ON public.tb_user_consent (id_user, aceito_em DESC);

-- ─── 7. Validade por treino (30/60/90) ───────────────────────────────────────
-- Ordem importa: a coluna nasce NULL, os planos que já existem recebem 90
-- (Q18), e só então vem o DEFAULT 60 (para os novos) e o NOT NULL.
ALTER TABLE public.tb_workout_plan ADD COLUMN IF NOT EXISTS validade_dias SMALLINT NULL;

UPDATE public.tb_workout_plan SET validade_dias = 90 WHERE validade_dias IS NULL;

ALTER TABLE public.tb_workout_plan ALTER COLUMN validade_dias SET DEFAULT 60;
ALTER TABLE public.tb_workout_plan ALTER COLUMN validade_dias SET NOT NULL;

ALTER TABLE public.tb_workout_plan DROP CONSTRAINT IF EXISTS chk_workout_plan_validade_dias;
ALTER TABLE public.tb_workout_plan ADD CONSTRAINT chk_workout_plan_validade_dias
  CHECK (validade_dias IN (30, 60, 90));
