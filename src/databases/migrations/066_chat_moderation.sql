-- =============================================================================
-- Migration 066: Moderação textual do Chat Global e Chat de Máquinas
-- =============================================================================
-- Sistema gratuito de moderação textual:
--   tb_blocked_term                 — lista própria de termos proibidos
--   tb_chat_moderation_result       — log de toda decisão de moderação
--   tb_chat_user_moderation_state   — mute/ban temporário por user
--   tb_chat_moderation_settings     — config por tipo de sala
-- A tabela tb_chat_report (mig 058) recebe colunas extras para reason category
-- e o threshold de auto-hide passa a usar essa contagem.
-- =============================================================================

-- ─── 1) Lista própria de termos proibidos ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_blocked_term (
  id_blocked_term  BIGSERIAL    PRIMARY KEY,
  term             TEXT         NOT NULL,
  normalized_term  TEXT         NOT NULL,
  category         VARCHAR(40)  NOT NULL
                     CHECK (category IN (
                       'profanity','harassment','hate','sexual','drugs','weapons',
                       'fraud','spam','platform_evasion','personal_data',
                       'minors_safety','forbidden_services','forbidden_products',
                       'suspicious_links'
                     )),
  severity         VARCHAR(20)  NOT NULL DEFAULT 'medium'
                     CHECK (severity IN ('low','medium','high','critical')),
  action           VARCHAR(20)  NOT NULL DEFAULT 'mask'
                     CHECK (action IN ('allow','warn','mask','block','review','mute_temp','ban_temp')),
  language         VARCHAR(10)  NOT NULL DEFAULT 'pt-BR',
  is_regex         BOOLEAN      NOT NULL DEFAULT FALSE,
  status           VARCHAR(20)  NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','paused')),
  notes            TEXT,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_blocked_term_normalized_lang
  ON public.tb_blocked_term (normalized_term, language);

CREATE INDEX IF NOT EXISTS idx_blocked_term_status
  ON public.tb_blocked_term (status, category);

-- ─── 2) Resultado de moderação (sempre logado) ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_chat_moderation_result (
  id_moderation_result BIGSERIAL    PRIMARY KEY,
  id_chat_message      UUID         REFERENCES public.tb_chat_message(id_chat_message) ON DELETE SET NULL,
  id_chat_room         UUID         REFERENCES public.tb_chat_room(id_chat_room) ON DELETE SET NULL,
  id_user              UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  original_text        TEXT         NOT NULL,
  normalized_text      TEXT         NOT NULL,
  action               VARCHAR(20)  NOT NULL
                         CHECK (action IN ('allow','warn','mask','block','review','mute_temp','ban_temp','hide')),
  risk_score           INT          NOT NULL DEFAULT 0,
  flags                JSONB        NOT NULL DEFAULT '[]'::jsonb,
  matched_terms        JSONB        NOT NULL DEFAULT '[]'::jsonb,
  reason               TEXT,
  review_status        VARCHAR(20)  NOT NULL DEFAULT 'none'
                         CHECK (review_status IN ('none','pending','approved','kept_blocked','dismissed')),
  reviewed_by          UUID         REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  reviewed_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_moderation_review_pending
  ON public.tb_chat_moderation_result (created_at DESC)
  WHERE review_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_moderation_user_recent
  ON public.tb_chat_moderation_result (id_user, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_moderation_action
  ON public.tb_chat_moderation_result (action, created_at DESC);

-- ─── 3) Estado de moderação do user (mute / ban público) ─────────────────────
CREATE TABLE IF NOT EXISTS public.tb_chat_user_moderation_state (
  id_user                   UUID         PRIMARY KEY REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  public_chat_muted_until   TIMESTAMPTZ,
  public_chat_banned_until  TIMESTAMPTZ,
  warning_count             INT          NOT NULL DEFAULT 0,
  last_violation_at         TIMESTAMPTZ,
  notes                     TEXT,
  created_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_mute_active
  ON public.tb_chat_user_moderation_state (public_chat_muted_until)
  WHERE public_chat_muted_until IS NOT NULL;

-- ─── 4) Configurações de moderação por tipo de sala ──────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_chat_moderation_settings (
  room_type                  VARCHAR(20)  PRIMARY KEY
                               CHECK (room_type IN ('global','machine')),
  max_message_length         INT          NOT NULL DEFAULT 500,
  max_messages_per_window    INT          NOT NULL DEFAULT 5,
  window_seconds             INT          NOT NULL DEFAULT 10,
  auto_hide_report_threshold INT          NOT NULL DEFAULT 3,
  review_report_threshold    INT          NOT NULL DEFAULT 5,
  mute_temp_minutes          INT          NOT NULL DEFAULT 10,
  ban_temp_minutes           INT          NOT NULL DEFAULT 1440,
  score_thresholds           JSONB        NOT NULL DEFAULT '{"mask":21,"review":41,"block":61,"mute":81}'::jsonb,
  active                     BOOLEAN      NOT NULL DEFAULT TRUE,
  updated_at                 TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO public.tb_chat_moderation_settings (room_type)
  VALUES ('global')
  ON CONFLICT (room_type) DO NOTHING;

INSERT INTO public.tb_chat_moderation_settings (room_type, max_message_length)
  VALUES ('machine', 500)
  ON CONFLICT (room_type) DO NOTHING;

-- ─── 5) Extras em tb_chat_report (mig 058) + auto-hide em tb_chat_message ────
ALTER TABLE public.tb_chat_report
  ADD COLUMN IF NOT EXISTS reason_category VARCHAR(40);

ALTER TABLE public.tb_chat_message
  ADD COLUMN IF NOT EXISTS hidden_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hidden_reason    VARCHAR(40),
  ADD COLUMN IF NOT EXISTS masked_content   TEXT,
  ADD COLUMN IF NOT EXISTS moderation_action VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_chat_message_hidden
  ON public.tb_chat_message (hidden_at) WHERE hidden_at IS NOT NULL;

-- ─── 6) Seed inicial mínima (admin pode editar/desativar pelo painel) ────────
-- Mantemos o seed pequeno e conservador. PT-BR não vem no dicionário do
-- leo-profanity, então alimentamos via blocked_terms. Lista intencionalmente
-- enxuta para começar — o admin amplia pelo /administracao/blocked-terms.
INSERT INTO public.tb_blocked_term (term, normalized_term, category, severity, action, language, notes)
VALUES
  -- Profanity PT-BR (alguns clássicos; admin amplia depois)
  ('caralho',     'caralho',     'profanity', 'medium',   'mask',  'pt-BR', 'seed'),
  ('porra',       'porra',       'profanity', 'low',      'mask',  'pt-BR', 'seed'),
  ('merda',       'merda',       'profanity', 'low',      'mask',  'pt-BR', 'seed'),
  ('puta que pariu','puta que pariu','profanity','medium','mask',  'pt-BR', 'seed'),
  ('vai se foder','vai se foder','harassment','high',     'block', 'pt-BR', 'seed'),
  ('filho da puta','filho da puta','harassment','high',   'block', 'pt-BR', 'seed'),
  -- Platform evasion
  ('zap',         'zap',         'platform_evasion','low',  'warn',  'pt-BR', 'whatsapp slang'),
  ('whatsapp',    'whatsapp',    'platform_evasion','low',  'warn',  'pt-BR', 'seed'),
  ('telegram',    'telegram',    'platform_evasion','low',  'warn',  'pt-BR', 'seed'),
  ('chama no zap','chama no zap','platform_evasion','medium','review','pt-BR', 'seed'),
  ('me chama no whats','me chama no whats','platform_evasion','medium','review','pt-BR', 'seed'),
  ('pagamento por fora','pagamento por fora','fraud','high',     'block', 'pt-BR', 'seed'),
  ('fora da plataforma','fora da plataforma','platform_evasion','medium','review','pt-BR', 'seed'),
  -- Drugs / weapons (placeholders neutros — admin define lista real)
  ('cocaina',     'cocaina',     'drugs',     'critical', 'block', 'pt-BR', 'seed'),
  ('maconha',     'maconha',     'drugs',     'high',     'review','pt-BR', 'seed'),
  -- Suspicious link shorteners
  ('bit.ly',      'bit.ly',      'suspicious_links','medium','review','pt-BR', 'shortener'),
  ('tinyurl.com', 'tinyurl.com', 'suspicious_links','medium','review','pt-BR', 'shortener'),
  ('encurtador',  'encurtador',  'suspicious_links','low',  'review','pt-BR', 'seed')
ON CONFLICT (normalized_term, language) DO NOTHING;
