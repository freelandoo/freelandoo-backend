-- =============================================================================
-- Migration 096: deleted_at em tb_service_request_response
-- =============================================================================
-- Permite "Excluir conversa" no /mensagens > O.S.: soft-delete por response.
-- Esconde o chat dos dois lados (usuário e profissional). Listagens em
-- /me/chats e /me/pro-chats devem filtrar por deleted_at IS NULL.
-- =============================================================================

ALTER TABLE public.tb_service_request_response
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS ix_tb_service_request_response_active
  ON public.tb_service_request_response (id_profile)
  WHERE deleted_at IS NULL;
