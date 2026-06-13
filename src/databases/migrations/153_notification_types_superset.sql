-- =============================================================================
-- Migration 153: CHECK de tb_notification — SUPERSET completo (correção)
-- =============================================================================
-- Conserta duas perdas de tipo no histórico do CHECK:
--   * A mig 071 recriou o CHECK e DROPOU 'supervised_message_received' e
--     'parental_permission_request' (que a 062 tinha adicionado) → essas
--     notificações falhavam silenciosamente (insert em try/catch) desde então.
--   * A mig 152 recriou o CHECK e DROPOU 'product_request_new' e
--     'product_response_new' (que a 071 tinha adicionado) → idem.
--
-- Esta migration define o CHECK como o SUPERSET de TODOS os tipos realmente
-- inseridos em tb_notification no código. Regra daqui pra frente: ao adicionar
-- tipo novo, criar nova migration que reescreve o CHECK inteiro a partir desta
-- lista (nunca um subconjunto).

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
    -- comercial (152 / slice C)
    'product_sale',
    'course_sale',
    'booking_received',
    -- chamados / O.S. (slice D)
    'service_response_received',
    'chamado_match',
    -- financeiro (slice E)
    'affiliate_commission_released',
    'subscription_expiring',
    'premium_expiring',
    'manifestation_expiring',
    -- social extra (slice F)
    'live_started',
    'clan_invite',
    'clan_member_joined',
    'live_gift_received'
  )) NOT VALID;
