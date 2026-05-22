-- =============================================================================
-- Migration 090: opt-in de afiliados por item
-- =============================================================================
-- O criador de um curso / produto de loja / serviço de perfil pode aceitar
-- (ou recusar) que afiliados vendam aquele item.
--
--   affiliates_allowed — se afiliados podem promover/vender o item.
--
-- A comissão em si é a regra GLOBAL do admin (tb_affiliate_settings) — o
-- criador não define porcentagem, só liga/desliga o opt-in.
-- Idempotente: ADD COLUMN IF NOT EXISTS.
-- =============================================================================

ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS affiliates_allowed BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.tb_profile_product
  ADD COLUMN IF NOT EXISTS affiliates_allowed BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.tb_profile_service
  ADD COLUMN IF NOT EXISTS affiliates_allowed BOOLEAN NOT NULL DEFAULT FALSE;
