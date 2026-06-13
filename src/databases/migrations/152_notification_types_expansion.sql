-- =============================================================================
-- Migration 152: Expansão dos tipos de notificação (auditoria do sino)
-- =============================================================================
-- O sino só cobria interações sociais (like/comment/follow/message) + supervisão.
-- A auditoria achou eventos comerciais/financeiros/sociais sem nenhum aviso.
-- Esta migration libera os novos tipos no CHECK (os produtores entram por slice):
--   Comercial:  product_sale, course_sale, booking_received
--   Chamados:   service_response_received, chamado_match
--   Financeiro: affiliate_commission_released, subscription_expiring,
--               premium_expiring, manifestation_expiring
--   Social:     live_started, clan_invite, clan_member_joined, live_gift_received

ALTER TABLE public.tb_notification
  DROP CONSTRAINT IF EXISTS tb_notification_type_chk;

ALTER TABLE public.tb_notification
  ADD CONSTRAINT tb_notification_type_chk
  CHECK (type IN (
    -- existentes (migs 057/062)
    'like_received',
    'comment_received',
    'follow_received',
    'message_received',
    'supervised_message_received',
    'parental_permission_request',
    -- comercial
    'product_sale',
    'course_sale',
    'booking_received',
    -- chamados / O.S.
    'service_response_received',
    'chamado_match',
    -- financeiro
    'affiliate_commission_released',
    'subscription_expiring',
    'premium_expiring',
    'manifestation_expiring',
    -- social extra
    'live_started',
    'clan_invite',
    'clan_member_joined',
    'live_gift_received'
  ));

-- Dedupe leve para avisos de expiração: no máximo 1 aviso não-lido por
-- (usuário, tipo, entidade). Evita reenvio diário do mesmo "vai expirar".
CREATE UNIQUE INDEX IF NOT EXISTS ux_notif_dedupe_expiring
  ON public.tb_notification (id_recipient_user, type, entity_id)
  WHERE type IN ('subscription_expiring', 'premium_expiring', 'manifestation_expiring')
    AND entity_id IS NOT NULL
    AND read_at IS NULL;
