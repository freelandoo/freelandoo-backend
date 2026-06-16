-- =============================================================================
-- Migration 162: Recados (posts só-texto) no feed da comunidade
-- Estende tb_community_feed_item para suportar 2 tipos de item de feed:
--   'post'   → liga um portfolio-item de um membro (comportamento atual, mig 160).
--   'recado' → nota só-texto (até 2000 chars) que vive SÓ no feed da comunidade.
--              NÃO existe como portfolio-item, então nunca entra no /feed global
--              nem na galeria do perfil do membro — é exclusivo do grupo.
-- Idempotente. (O runner já envolve cada migration em transação própria.)
-- =============================================================================

ALTER TABLE public.tb_community_feed_item
  ADD COLUMN IF NOT EXISTS kind VARCHAR(12) NOT NULL DEFAULT 'post',
  ADD COLUMN IF NOT EXISTS body TEXT NULL;

-- Recados não têm portfolio-item.
ALTER TABLE public.tb_community_feed_item
  ALTER COLUMN id_portfolio_item DROP NOT NULL;

-- Coerência por tipo: post exige item; recado exige body (≤2000) e item NULL.
ALTER TABLE public.tb_community_feed_item
  DROP CONSTRAINT IF EXISTS chk_community_feed_item_kind;
ALTER TABLE public.tb_community_feed_item
  ADD CONSTRAINT chk_community_feed_item_kind CHECK (
    ( kind = 'post'   AND id_portfolio_item IS NOT NULL ) OR
    ( kind = 'recado' AND id_portfolio_item IS NULL
                      AND body IS NOT NULL
                      AND char_length(body) <= 2000 )
  );

-- O UNIQUE antigo (community,item) deve ignorar recados (item NULL): vira parcial.
DROP INDEX IF EXISTS public.ux_community_feed_item;
CREATE UNIQUE INDEX IF NOT EXISTS ux_community_feed_item
  ON public.tb_community_feed_item (id_community_profile, id_portfolio_item)
  WHERE id_portfolio_item IS NOT NULL;

-- Lookup do link por item (usado pelo /feed global p/ o botão "Acessar comunidade").
CREATE INDEX IF NOT EXISTS idx_community_feed_item_item
  ON public.tb_community_feed_item (id_portfolio_item)
  WHERE id_portfolio_item IS NOT NULL;

-- Listagem cronológica de recados de uma comunidade.
CREATE INDEX IF NOT EXISTS idx_community_feed_item_recado
  ON public.tb_community_feed_item (id_community_profile, created_at DESC)
  WHERE kind = 'recado';
