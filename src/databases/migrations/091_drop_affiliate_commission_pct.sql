-- =============================================================================
-- Migration 091: remove affiliate_commission_pct dos itens
-- =============================================================================
-- A versão inicial da 090 adicionava uma % de comissão por item. Decisão
-- revista: o criador só ACEITA ou RECUSA afiliados; a comissão é a regra
-- global do admin. A coluna por item deixa de existir.
-- DROP COLUMN remove junto a CHECK constraint dependente. Idempotente.
-- =============================================================================

ALTER TABLE public.courses
  DROP COLUMN IF EXISTS affiliate_commission_pct;

ALTER TABLE public.tb_profile_product
  DROP COLUMN IF EXISTS affiliate_commission_pct;

ALTER TABLE public.tb_profile_service
  DROP COLUMN IF EXISTS affiliate_commission_pct;
