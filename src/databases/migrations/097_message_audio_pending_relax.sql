-- =============================================================================
-- Migration 097: relaxa tb_message_audio_chk pra permitir placeholder pendente
-- =============================================================================
-- A constraint anterior (mig 080) exigia audio_url E audio_storage_key sempre
-- que kind='audio'. Mas o fluxo do ConversationService.sendAudioMessage faz
-- duas etapas:
--   1) createAudioPending INSERT com kind='audio', status='processing' e
--      audio_url/audio_storage_key NULL (placeholder).
--   2) finalizeAudio UPDATE com a URL e key R2 + status='ready'.
-- A constraint antiga barrava o passo 1 com violação de CHECK, então nenhum
-- áudio era criado. Esta migration troca pra: só exige audio_url/key quando
-- o status já é 'ready' (estado final). Estados intermediários (processing,
-- failed) ficam liberados.
-- =============================================================================

ALTER TABLE public.tb_message
  DROP CONSTRAINT IF EXISTS tb_message_audio_chk;

ALTER TABLE public.tb_message
  ADD CONSTRAINT tb_message_audio_chk
  CHECK (
    kind <> 'audio'
    OR media_processing_status <> 'ready'
    OR (audio_url IS NOT NULL AND audio_storage_key IS NOT NULL)
  );
