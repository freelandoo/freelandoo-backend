-- =============================================================================
-- Migration 065: Etiqueta Melhor Envio em tb_profile_product_order
-- =============================================================================
-- Adiciona colunas para a compra automática de etiqueta no Melhor Envio após
-- o webhook checkout.session.completed marcar o pedido como `paid`.
-- O ID do pedido ME, a URL do PDF, timestamps e contagem de tentativas/erro
-- ficam aqui pra suportar retry idempotente.
-- =============================================================================

ALTER TABLE public.tb_profile_product_order
  ADD COLUMN IF NOT EXISTS melhor_envio_order_id   TEXT,
  ADD COLUMN IF NOT EXISTS label_pdf_url           TEXT,
  ADD COLUMN IF NOT EXISTS label_purchased_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS label_purchase_error    TEXT,
  ADD COLUMN IF NOT EXISTS label_purchase_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS label_last_attempt_at   TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_pp_order_label_pending
  ON public.tb_profile_product_order (label_last_attempt_at)
  WHERE status = 'paid'
    AND label_purchased_at IS NULL
    AND label_purchase_attempts < 5;
