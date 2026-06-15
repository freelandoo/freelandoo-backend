-- =============================================================================
-- Migration 158: Banner da Comunidade (capa estilo curso)
-- Coluna de URL da imagem de capa, editável só pelo líder. Avatar e cores
-- (community_theme) já existiam; o banner é uma superfície nova no topo da
-- página da comunidade. Idempotente.
-- =============================================================================

ALTER TABLE public.tb_profile
  ADD COLUMN IF NOT EXISTS community_banner_url TEXT;
