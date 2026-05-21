-- =============================================================================
-- Migration 086 — tb_item.is_subscription
-- =============================================================================
-- Adiciona flag para distinguir o item de assinatura (anuidade R$300/ano) dos
-- demais itens compráveis. A regra de cupom passa a aplicar desconto SOMENTE
-- quando is_subscription = TRUE; nos outros casos o cupom é registrado apenas
-- para fins de comissão de afiliado.
-- =============================================================================

ALTER TABLE public.tb_item
  ADD COLUMN IF NOT EXISTS is_subscription BOOLEAN NOT NULL DEFAULT FALSE;

-- Marca o item da anuidade (ID fixo usado pelo frontend /checkout).
UPDATE public.tb_item
   SET is_subscription = TRUE
 WHERE id_item = '0fe91e60-12f0-4a1c-a297-262d73e5fce5';

COMMENT ON COLUMN public.tb_item.is_subscription IS
  'Quando TRUE, este item é elegível para desconto via cupom. Demais itens só geram comissão.';
