-- =============================================================================
-- Migration 069: Adiciona id_product_category em tb_profile_product
-- =============================================================================
-- Categoria nullable nesta fase: produtos legacy ficam sem categoria até serem
-- reeditados pelo dono. UI nova obriga categoria no cadastro. Em slice posterior,
-- backfill com "Outros" e tornar NOT NULL.
-- ON DELETE RESTRICT: impede remoção acidental de categoria com produtos vinculados.
-- =============================================================================

ALTER TABLE public.tb_profile_product
  ADD COLUMN IF NOT EXISTS id_product_category INT
    REFERENCES public.tb_product_category(id_product_category) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_profile_product_category
  ON public.tb_profile_product (id_product_category, is_active)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.tb_profile_product.id_product_category IS
  'Categoria do produto (tb_product_category). Obrigatório em novos cadastros via service layer; legacy pode estar NULL até backfill.';
