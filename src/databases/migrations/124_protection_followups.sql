-- =============================================================================
-- Migration 124: Follow-ups da Proteção de Pagamento
-- =============================================================================
-- 1) return_shipping_cents no pedido: parte do frete embutida (ida+volta) que a
--    plataforma retém para custear a etiqueta reversa. No reembolso de DEVOLUÇÃO
--    o comprador recebe (total - return_shipping_cents); nos demais, recebe tudo.
-- 2) Tipos de notificação de disputa (canal do sino / notificações).
-- Idempotente.
-- =============================================================================

ALTER TABLE public.tb_profile_product_order
  ADD COLUMN IF NOT EXISTS return_shipping_cents INT NOT NULL DEFAULT 0;

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
    'parental_permission_request',
    'dispute_opened',
    'dispute_resolved'
  ));
