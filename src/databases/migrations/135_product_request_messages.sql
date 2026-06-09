-- =============================================================================
-- Migration 135: thread de mensagens dos Pedidos de Produto (chat real na O.S.)
-- =============================================================================
-- Antes, a resposta do vendedor a um Pedido de Produto era "one-shot" (um único
-- texto, read-only na aba O.S.). Agora vira CONVERSA, igual serviço/curso: cada
-- tb_product_request_response ganha uma thread de mensagens (USER ⇄ PRO).
--
-- O `message` da resposta deixa de ser obrigatório no fluxo novo (a conversa
-- nasce ao clicar "Responder" no Mural e a troca acontece na thread).
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.tb_product_request_message (
  id_message    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_response   UUID         NOT NULL REFERENCES public.tb_product_request_response(id_response) ON DELETE CASCADE,
  sender        VARCHAR(8)   NOT NULL CHECK (sender IN ('USER','PRO')),
  content       TEXT         NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_product_request_message_response
  ON public.tb_product_request_message (id_response, created_at);

-- A conversa pode nascer sem texto inicial → message passa a aceitar vazio.
ALTER TABLE public.tb_product_request_response
  ALTER COLUMN message DROP NOT NULL;

COMMIT;
