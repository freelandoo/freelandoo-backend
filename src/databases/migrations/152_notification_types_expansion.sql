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

-- NOTA (correção pós-incidente 2026-06-13): a versão original desta migration
-- recriava o CHECK SEM 'product_request_new'/'product_response_new' (que a mig
-- 071 havia adicionado) e fazia ADD CONSTRAINT validado → o Postgres rejeitava
-- por causa de linhas antigas desses tipos, abortando TODO o boot (502). Esta
-- migration nunca chegou a aplicar com sucesso, então foi corrigida no lugar:
-- lista vira SUPERSET completo + NOT VALID (não varre linhas antigas; INSERT/
-- UPDATE novos continuam validados). A mig 153 reforça o mesmo CHECK.

ALTER TABLE public.tb_notification
  DROP CONSTRAINT IF EXISTS tb_notification_type_chk;

ALTER TABLE public.tb_notification
  ADD CONSTRAINT tb_notification_type_chk
  CHECK (type IN (
    -- social (057)
    'like_received',
    'comment_received',
    'follow_received',
    'message_received',
    -- supervisão (062)
    'supervised_message_received',
    'parental_permission_request',
    -- pedidos de produto (071)
    'product_request_new',
    'product_response_new',
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
  )) NOT VALID;

-- Dedupe leve para avisos de expiração: no máximo 1 aviso não-lido por
-- (usuário, tipo, entidade). Evita reenvio diário do mesmo "vai expirar".
CREATE UNIQUE INDEX IF NOT EXISTS ux_notif_dedupe_expiring
  ON public.tb_notification (id_recipient_user, type, entity_id)
  WHERE type IN ('subscription_expiring', 'premium_expiring', 'manifestation_expiring')
    AND entity_id IS NOT NULL
    AND read_at IS NULL;
