-- =============================================================================
-- Migration 062: Extras de Conta Supervisionada
-- =============================================================================
-- - Amplia o CHECK de tb_notification.type para cobrir:
--   * 'supervised_message_received' — responsável recebe quando o menor é
--     destinatário de uma mensagem privada.
--   * 'parental_permission_request' — menor solicita liberação de toggle ao
--     responsável (ex.: vender cursos).
-- - Dedupe leve para a request: evita 50 pedidos do mesmo toggle se o menor
--   clicar repetidas vezes antes do responsável agir.
-- =============================================================================

BEGIN;

ALTER TABLE public.tb_notification
  DROP CONSTRAINT IF EXISTS tb_notification_type_chk;
ALTER TABLE public.tb_notification
  ADD CONSTRAINT tb_notification_type_chk
  CHECK (type IN (
    'like_received',
    'comment_received',
    'follow_received',
    'message_received',
    'supervised_message_received',
    'parental_permission_request'
  ));

-- Dedupe parcial para pedidos de permissão por chave (mesmo menor → mesma chave
-- → mesmo responsável → não-lido = só 1 ativo por vez).
CREATE UNIQUE INDEX IF NOT EXISTS ux_notif_dedupe_perm_request
  ON public.tb_notification (id_recipient_user, type, id_actor_user, (payload->>'permission_key'))
  WHERE type = 'parental_permission_request'
    AND read_at IS NULL;

COMMIT;
