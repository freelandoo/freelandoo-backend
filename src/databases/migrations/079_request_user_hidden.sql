-- =============================================================================
-- Migration 079: "Remover" da lista do user (soft-hide) — service + product
-- =============================================================================
-- O user agora pode esconder linhas da própria lista de Minhas Solicitações /
-- Meus Pedidos sem afetar o histórico no banco. A coluna user_hidden_at é
-- preenchida quando o user clica em "Remover". O mural / responses dos
-- profissionais continua vendo o registro normalmente.
-- =============================================================================

ALTER TABLE public.tb_service_request
  ADD COLUMN IF NOT EXISTS user_hidden_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_service_request_user_visible
  ON public.tb_service_request (id_user, created_at DESC)
  WHERE user_hidden_at IS NULL;

ALTER TABLE public.tb_product_request
  ADD COLUMN IF NOT EXISTS user_hidden_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_product_request_user_visible
  ON public.tb_product_request (id_buyer_user, created_at DESC)
  WHERE user_hidden_at IS NULL;
