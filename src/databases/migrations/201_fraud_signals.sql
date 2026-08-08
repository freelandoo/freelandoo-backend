-- =============================================================================
-- Migration 201: Painel de Fraude — sinais de cadastro, fila de revisão humana
-- e bloqueio de conta
-- =============================================================================
-- Decisão do Alex (2026-08-08): antifraude de CUSTO ZERO. Nada de bureau pago —
-- só heurística offline + olho humano. O princípio: sinal NUNCA bloqueia
-- sozinho; ele PONTUA e joga o caso numa fila que um administrador revisa.
--
-- 1) tb_user_signup_context — a prova bruta do cadastro (IP, user-agent,
--    domínio de e-mail, origem). Uma linha por usuário, gravada no signup.
--    Sem isso não existe velocity: "3 contas do mesmo IP em 10 minutos" só é
--    calculável se o IP tiver sido guardado na hora.
--
-- 2) tb_fraud_review — a fila. Uma revisão ABERTA por usuário (UNIQUE parcial);
--    reavaliar um caso já pendente atualiza a linha em vez de empilhar. Guarda
--    score + reasons (JSONB com {code, weight, detail}) pra tela mostrar o
--    porquê, e a decisão do humano (cleared / watch / blocked).
--
-- 3) tb_user.blocked_at/blocked_reason/blocked_by — bloqueio de verdade.
--    tb_user.ativo NÃO servia: ali `ativo` significa "e-mail verificado", e o
--    usuário reativa sozinho pelo link de ativação. O gate novo é checado no
--    signin e no login Google.
--
-- LGPD: guardamos IP e user-agent do cadastro por interesse legítimo (prevenção
-- à fraude). Não guardamos nada vindo de consulta externa — não há consulta
-- externa neste desenho.
--
-- Idempotente.
-- =============================================================================

BEGIN;

-- ─── 1. Contexto do cadastro ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_user_signup_context (
  id_user        UUID         PRIMARY KEY REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  signup_ip      VARCHAR(64),
  user_agent     TEXT,
  email_domain   VARCHAR(190),
  signup_source  VARCHAR(20)  NOT NULL DEFAULT 'email'
                   CHECK (signup_source IN ('email', 'google')),
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Velocity por IP: "quantas contas nasceram deste IP" e "quantas na última
-- hora" são a MESMA varredura — índice composto por (ip, data).
CREATE INDEX IF NOT EXISTS idx_signup_context_ip
  ON public.tb_user_signup_context (signup_ip, created_at DESC)
  WHERE signup_ip IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_signup_context_domain
  ON public.tb_user_signup_context (email_domain);

-- ─── 2. Fila de revisão humana ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_fraud_review (
  id_review      BIGSERIAL    PRIMARY KEY,
  id_user        UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  score          INT          NOT NULL DEFAULT 0 CHECK (score >= 0),
  reasons        JSONB        NOT NULL DEFAULT '[]'::jsonb,
  status         VARCHAR(20)  NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'cleared', 'watch', 'blocked')),
  notes          TEXT,
  decided_at     TIMESTAMPTZ,
  decided_by     UUID         REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- No máximo UMA revisão aberta por usuário: reavaliação atualiza a pendente.
-- Histórico de decisões antigas fica preservado (linhas já decididas).
CREATE UNIQUE INDEX IF NOT EXISTS ux_fraud_review_open
  ON public.tb_fraud_review (id_user)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_fraud_review_queue
  ON public.tb_fraud_review (status, score DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fraud_review_user
  ON public.tb_fraud_review (id_user, created_at DESC);

-- ─── 3. Bloqueio de conta ───────────────────────────────────────────────────
ALTER TABLE public.tb_user
  ADD COLUMN IF NOT EXISTS blocked_at     TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS blocked_reason TEXT        NULL,
  ADD COLUMN IF NOT EXISTS blocked_by     UUID        NULL;

ALTER TABLE public.tb_user
  DROP CONSTRAINT IF EXISTS tb_user_blocked_by_fk;
ALTER TABLE public.tb_user
  ADD CONSTRAINT tb_user_blocked_by_fk
  FOREIGN KEY (blocked_by) REFERENCES public.tb_user(id_user) ON DELETE SET NULL;

COMMENT ON COLUMN public.tb_user.blocked_at IS
  'Bloqueio administrativo (painel de fraude). Diferente de tb_user.ativo, que significa e-mail verificado. Checado no signin e no login Google.';

CREATE INDEX IF NOT EXISTS idx_tb_user_blocked
  ON public.tb_user (blocked_at)
  WHERE blocked_at IS NOT NULL;

-- ─── 4. Backfill do contexto pros cadastros já existentes ───────────────────
-- Sem IP (não foi guardado na época), mas com o domínio do e-mail, que é
-- derivável do dado que já temos. Assim a heurística de domínio descartável
-- vale pra base antiga desde o primeiro dia.
INSERT INTO public.tb_user_signup_context (id_user, email_domain, signup_source, created_at)
SELECT
  u.id_user,
  LOWER(SPLIT_PART(u.email, '@', 2)),
  CASE WHEN u.google_sub IS NOT NULL THEN 'google' ELSE 'email' END,
  COALESCE(u.created_at, NOW())
FROM public.tb_user u
WHERE u.email IS NOT NULL
  AND POSITION('@' IN u.email) > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.tb_user_signup_context c WHERE c.id_user = u.id_user
  );

COMMIT;
