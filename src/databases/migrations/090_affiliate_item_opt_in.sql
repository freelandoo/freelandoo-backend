-- =============================================================================
-- Migration 090: opt-in de afiliados por item
-- =============================================================================
-- O criador de um curso / produto de loja / serviço de perfil pode aceitar que
-- afiliados vendam aquele item. Quando aceita, define a comissão (%) que o
-- afiliado leva por venda.
--
--   affiliates_allowed       — se afiliados podem promover/vender o item.
--   affiliate_commission_pct — % da venda paga ao afiliado (padrão 25).
--
-- A flag é POR ITEM e sobrescreve a regra global/cupom na engine de afiliados.
-- Idempotente: ADD COLUMN IF NOT EXISTS.
-- =============================================================================

ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS affiliates_allowed       BOOLEAN       NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS affiliate_commission_pct NUMERIC(5,2)  NOT NULL DEFAULT 25;

ALTER TABLE public.tb_profile_product
  ADD COLUMN IF NOT EXISTS affiliates_allowed       BOOLEAN       NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS affiliate_commission_pct NUMERIC(5,2)  NOT NULL DEFAULT 25;

ALTER TABLE public.tb_profile_service
  ADD COLUMN IF NOT EXISTS affiliates_allowed       BOOLEAN       NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS affiliate_commission_pct NUMERIC(5,2)  NOT NULL DEFAULT 25;

-- Comissão entre 0 e 90% (idempotente: drop antes de re-adicionar).
ALTER TABLE public.courses
  DROP CONSTRAINT IF EXISTS courses_affiliate_commission_pct_chk;
ALTER TABLE public.courses
  ADD CONSTRAINT courses_affiliate_commission_pct_chk
  CHECK (affiliate_commission_pct >= 0 AND affiliate_commission_pct <= 90);

ALTER TABLE public.tb_profile_product
  DROP CONSTRAINT IF EXISTS tb_profile_product_affiliate_commission_pct_chk;
ALTER TABLE public.tb_profile_product
  ADD CONSTRAINT tb_profile_product_affiliate_commission_pct_chk
  CHECK (affiliate_commission_pct >= 0 AND affiliate_commission_pct <= 90);

ALTER TABLE public.tb_profile_service
  DROP CONSTRAINT IF EXISTS tb_profile_service_affiliate_commission_pct_chk;
ALTER TABLE public.tb_profile_service
  ADD CONSTRAINT tb_profile_service_affiliate_commission_pct_chk
  CHECK (affiliate_commission_pct >= 0 AND affiliate_commission_pct <= 90);
