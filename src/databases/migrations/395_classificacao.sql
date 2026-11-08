-- 395 — A6 CLASSIFICAÇÃO (2026-11-08): prova com nota 0–100 (TRI 2PL) e perfil
-- de personalidade (Big Five/IPIP-50, domínio público).
--
-- Regras em src/utils/classificacaoTri.js (nota) e src/utils/classificacaoRules.js
-- (quem vê, refazer a cada 30 dias, consentimento). Banco de itens em 396 (gerado).
--
-- ⚠️ A parte psicológica é dado potencialmente SENSÍVEL (LGPD art. 11): grava só com
-- consentimento (tb_personality_consent, log de concessão e revogação), as respostas
-- ficam SELADAS (secretBox) e nunca saem para outra pessoa. Apagar = DELETE da linha
-- + revogação no log. Tudo cai junto com a conta (ON DELETE CASCADE).

-- Banco de itens. `correct` = índice em `options`; a/b = parâmetros do 2PL.
CREATE TABLE IF NOT EXISTS public.tb_quiz_item (
  id_item      SERIAL PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE,
  area         TEXT NOT NULL,
  locale       TEXT NOT NULL DEFAULT 'pt-BR',
  stem         TEXT NOT NULL,
  options      JSONB NOT NULL,
  correct      SMALLINT NOT NULL,
  a            DOUBLE PRECISION NOT NULL,
  b            DOUBLE PRECISION NOT NULL,
  source       TEXT NOT NULL DEFAULT 'freelandoo',
  source_ref   TEXT,
  license      TEXT,
  attribution  TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_quiz_item_area CHECK (area IN ('economia', 'financas', 'historia', 'geografia', 'gerais')),
  CONSTRAINT chk_quiz_item_source CHECK (source IN ('freelandoo', 'enem', 'opentdb')),
  CONSTRAINT chk_quiz_item_options CHECK (jsonb_typeof(options) = 'array'),
  CONSTRAINT chk_quiz_item_correct CHECK (correct >= 0 AND correct < jsonb_array_length(options)),
  CONSTRAINT chk_quiz_item_a CHECK (a > 0 AND a <= 4),
  CONSTRAINT chk_quiz_item_b CHECK (b >= -4 AND b <= 4)
);
CREATE INDEX IF NOT EXISTS idx_quiz_item_locale ON public.tb_quiz_item (locale) WHERE is_active;

-- Uma prova feita (ou em andamento). `answers` = [{ id, area, a, b, choice, correct }]
-- com os parâmetros congelados no momento da resposta.
CREATE TABLE IF NOT EXISTS public.tb_quiz_attempt (
  id_attempt    BIGSERIAL PRIMARY KEY,
  id_user       UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  locale        TEXT NOT NULL DEFAULT 'pt-BR',
  status        TEXT NOT NULL DEFAULT 'open',
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMPTZ,
  pending_item  INTEGER REFERENCES public.tb_quiz_item(id_item),
  answers       JSONB NOT NULL DEFAULT '[]'::jsonb,
  theta         DOUBLE PRECISION,
  se            DOUBLE PRECISION,
  score         SMALLINT,
  areas         JSONB,
  CONSTRAINT chk_quiz_attempt_status CHECK (status IN ('open', 'done', 'expired')),
  CONSTRAINT chk_quiz_attempt_score CHECK (score IS NULL OR (score >= 0 AND score <= 100))
);
CREATE INDEX IF NOT EXISTS idx_quiz_attempt_user ON public.tb_quiz_attempt (id_user, started_at DESC);
-- No máximo UMA prova aberta por pessoa (duas abas não abrem duas provas).
CREATE UNIQUE INDEX IF NOT EXISTS ux_quiz_attempt_open ON public.tb_quiz_attempt (id_user) WHERE status = 'open';

-- A nota que vale (a da última prova concluída) e quem pode vê-la.
CREATE TABLE IF NOT EXISTS public.tb_quiz_result (
  id_user      UUID PRIMARY KEY REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  id_attempt   BIGINT NOT NULL REFERENCES public.tb_quiz_attempt(id_attempt) ON DELETE CASCADE,
  score        SMALLINT NOT NULL,
  finished_at  TIMESTAMPTZ NOT NULL,
  visibility   TEXT NOT NULL DEFAULT 'private',
  share_token  TEXT UNIQUE,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_quiz_result_visibility CHECK (visibility IN ('private', 'link', 'profile')),
  CONSTRAINT chk_quiz_result_score CHECK (score >= 0 AND score <= 100)
);

-- Log do consentimento da parte psicológica (nunca se apaga uma concessão: a
-- revogação é um evento novo; vale o último).
CREATE TABLE IF NOT EXISTS public.tb_personality_consent (
  id_event   BIGSERIAL PRIMARY KEY,
  id_user    UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  action     TEXT NOT NULL,
  version    TEXT NOT NULL,
  at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_personality_consent_action CHECK (action IN ('grant', 'revoke'))
);
CREATE INDEX IF NOT EXISTS idx_personality_consent_user ON public.tb_personality_consent (id_user, at DESC);

-- O perfil de personalidade: respostas + traços, SELADOS num texto só (secretBox).
CREATE TABLE IF NOT EXISTS public.tb_personality_profile (
  id_user          UUID PRIMARY KEY REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  payload_sealed   TEXT NOT NULL,
  consent_version  TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
