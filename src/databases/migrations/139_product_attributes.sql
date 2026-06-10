-- =============================================================================
-- Migration 139: Atributos de produto — subfiltros por categoria na busca
-- =============================================================================
-- JSONB livre por produto, preenchido pelo vendedor conforme a categoria
-- (ex.: calçados → {"sizes":["38","39"],"colors":["preto"],"brand":"Olympikus"}).
-- O schema dos campos por categoria vive no frontend (lib/product-attributes.ts);
-- o backend só sanitiza chaves/valores e filtra genericamente via attr_* na
-- busca pública (SearchController.searchProducts).
-- =============================================================================

ALTER TABLE public.tb_profile_product
  ADD COLUMN IF NOT EXISTS attributes JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.tb_profile_product.attributes IS
  'Atributos filtráveis por categoria (tamanhos, cores, marca, voltagem etc). Chaves [a-z0-9_], valores string ou array de strings.';

-- GIN padrão (jsonb_ops) para suportar ?| e @> nos filtros da busca.
CREATE INDEX IF NOT EXISTS idx_profile_product_attributes
  ON public.tb_profile_product USING GIN (attributes);
