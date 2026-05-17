-- =============================================================================
-- Migration 080: Áudio em mensagens privadas 1-a-1
-- =============================================================================
-- Estende tb_message para suportar mensagens de áudio (WebM/Opus 24kbps).
--
-- Decisões:
--   - Coluna `kind` em tb_message ('text' | 'audio'). DEFAULT 'text' para
--     preservar mensagens existentes.
--   - Quando kind='audio', body pode ser NULL (relaxa NOT NULL e o CHECK de
--     comprimento). Em 'text' continua obrigatório 1..4000 chars.
--   - Áudio só é permitido em conversa kind='direct' (regra de produto).
--     A validação fica no service; o schema não tem como expressar isso de
--     forma performática (cross-table CHECK exigiria trigger).
--   - audio_storage_key guarda a key R2 para permitir delete real ao
--     apagar a mensagem (best-effort no service).
--   - media_processing_status: 'ready' | 'processing' | 'failed'. Hoje o
--     upload é síncrono, então sempre fica 'ready', mas a coluna fica
--     reservada para futuros chunked uploads/async pipelines.
-- =============================================================================

BEGIN;

-- ─── Coluna kind ───────────────────────────────────────────────────────────
ALTER TABLE public.tb_message
  ADD COLUMN IF NOT EXISTS kind VARCHAR(16) NOT NULL DEFAULT 'text';

ALTER TABLE public.tb_message
  DROP CONSTRAINT IF EXISTS tb_message_kind_chk;
ALTER TABLE public.tb_message
  ADD CONSTRAINT tb_message_kind_chk
  CHECK (kind IN ('text','audio'));

-- ─── body opcional quando kind='audio' ─────────────────────────────────────
ALTER TABLE public.tb_message
  ALTER COLUMN body DROP NOT NULL;

-- Remove o CHECK antigo de body (que exigia 1..4000) e troca por um condicional
ALTER TABLE public.tb_message
  DROP CONSTRAINT IF EXISTS tb_message_body_check;
ALTER TABLE public.tb_message
  DROP CONSTRAINT IF EXISTS tb_message_body_chk;
ALTER TABLE public.tb_message
  ADD CONSTRAINT tb_message_body_chk
  CHECK (
    (kind = 'text' AND body IS NOT NULL AND char_length(body) BETWEEN 1 AND 4000)
    OR (kind = 'audio' AND (body IS NULL OR char_length(body) <= 280))
  );

-- ─── Colunas de áudio ──────────────────────────────────────────────────────
ALTER TABLE public.tb_message
  ADD COLUMN IF NOT EXISTS audio_url               TEXT,
  ADD COLUMN IF NOT EXISTS audio_storage_key       TEXT,
  ADD COLUMN IF NOT EXISTS audio_duration_seconds  INT,
  ADD COLUMN IF NOT EXISTS audio_size_bytes        BIGINT,
  ADD COLUMN IF NOT EXISTS audio_mime_type         VARCHAR(64),
  ADD COLUMN IF NOT EXISTS audio_codec             VARCHAR(32),
  ADD COLUMN IF NOT EXISTS audio_bitrate           INT,
  ADD COLUMN IF NOT EXISTS media_processing_status VARCHAR(16) NOT NULL DEFAULT 'ready';

ALTER TABLE public.tb_message
  DROP CONSTRAINT IF EXISTS tb_message_audio_chk;
ALTER TABLE public.tb_message
  ADD CONSTRAINT tb_message_audio_chk
  CHECK (
    kind <> 'audio'
    OR (audio_url IS NOT NULL AND audio_storage_key IS NOT NULL)
  );

ALTER TABLE public.tb_message
  DROP CONSTRAINT IF EXISTS tb_message_media_proc_status_chk;
ALTER TABLE public.tb_message
  ADD CONSTRAINT tb_message_media_proc_status_chk
  CHECK (media_processing_status IN ('ready','processing','failed'));

-- ─── Index para limpeza/auditoria de áudios ────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_message_audio_pending_delete
  ON public.tb_message (audio_storage_key)
  WHERE audio_storage_key IS NOT NULL;

COMMIT;
