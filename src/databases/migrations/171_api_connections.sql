-- =============================================================================
-- Migration 171: API de Atendimento (conexões externas de mensagens)
-- =============================================================================
-- tb_api_connection: token pessoal (hash SHA-256) que autoriza um software de
-- terceiro a ler/responder mensagens do dono. Escopo: O.S. sempre + conversas
-- diretas criadas após a conexão + (scope_personal) histórico pessoal.
-- tb_api_webhook_delivery: fila/log de entrega de webhook com retry.
-- sent_via em tb_message e tb_service_request_message: selo "via atendimento"
-- visível só para o dono.
-- Idempotente (IF NOT EXISTS / DROP CONSTRAINT IF EXISTS antes de ADD).
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.tb_api_connection (
  id_connection   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user         UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  name            VARCHAR(80)  NOT NULL,
  token_hash      VARCHAR(64)  NOT NULL,
  token_prefix    VARCHAR(20)  NOT NULL,
  scope_personal  BOOLEAN      NOT NULL DEFAULT FALSE,
  webhook_url     TEXT         NULL,
  webhook_secret  VARCHAR(64)  NOT NULL,
  status          VARCHAR(16)  NOT NULL DEFAULT 'active',
  last_used_at    TIMESTAMPTZ  NULL,
  last_ip         VARCHAR(64)  NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  revoked_at      TIMESTAMPTZ  NULL,
  CONSTRAINT tb_api_connection_status_chk CHECK (status IN ('active','revoked'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_api_connection_token_hash
  ON public.tb_api_connection (token_hash);

CREATE INDEX IF NOT EXISTS idx_api_connection_user_active
  ON public.tb_api_connection (id_user)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.tb_api_webhook_delivery (
  id_delivery     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_connection   UUID         NOT NULL REFERENCES public.tb_api_connection(id_connection) ON DELETE CASCADE,
  event_type      VARCHAR(40)  NOT NULL,
  payload         JSONB        NOT NULL,
  status          VARCHAR(16)  NOT NULL DEFAULT 'pending',
  attempts        INT          NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_error      TEXT         NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  delivered_at    TIMESTAMPTZ  NULL,
  CONSTRAINT tb_api_webhook_delivery_status_chk CHECK (status IN ('pending','delivered','failed'))
);

CREATE INDEX IF NOT EXISTS idx_api_webhook_delivery_due
  ON public.tb_api_webhook_delivery (next_attempt_at)
  WHERE status = 'pending';

ALTER TABLE public.tb_message
  ADD COLUMN IF NOT EXISTS sent_via VARCHAR(8) NOT NULL DEFAULT 'app';
ALTER TABLE public.tb_message
  DROP CONSTRAINT IF EXISTS tb_message_sent_via_chk;
ALTER TABLE public.tb_message
  ADD CONSTRAINT tb_message_sent_via_chk CHECK (sent_via IN ('app','api'));

ALTER TABLE public.tb_service_request_message
  ADD COLUMN IF NOT EXISTS sent_via VARCHAR(8) NOT NULL DEFAULT 'app';
ALTER TABLE public.tb_service_request_message
  DROP CONSTRAINT IF EXISTS tb_service_request_message_sent_via_chk;
ALTER TABLE public.tb_service_request_message
  ADD CONSTRAINT tb_service_request_message_sent_via_chk CHECK (sent_via IN ('app','api'));

INSERT INTO public.tb_feature_flag (flag_key, label, description)
VALUES (
  'atendimento_api',
  'API de Atendimento',
  'Conexões externas de mensagens: tokens de API pessoais gerados em /mensagens que permitem a um software de atendimento ler e responder conversas (O.S. + diretas) via /ext/v1 com webhook push. Desligar bloqueia as rotas /ext/v1 (403) e esconde o botão "Conectar atendimento". Tokens e histórico de entregas são preservados.'
)
ON CONFLICT (flag_key) DO NOTHING;

COMMIT;
