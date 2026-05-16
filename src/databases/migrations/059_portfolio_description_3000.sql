-- =============================================================================
-- Migration 059: Limite formal de 3000 caracteres na descrição de posts
-- =============================================================================
-- Hoje description é TEXT sem CHECK. O feed agora exibe descrição expansível
-- até 3000 chars (UX padrão Instagram). Adiciona constraint idempotente.
-- =============================================================================

ALTER TABLE public.tb_profile_portfolio_item
  DROP CONSTRAINT IF EXISTS tb_profile_portfolio_item_description_chk;

ALTER TABLE public.tb_profile_portfolio_item
  ADD CONSTRAINT tb_profile_portfolio_item_description_chk
  CHECK (description IS NULL OR char_length(description) <= 3000);
