-- =============================================================================
-- Migration 111: Conveniência Views vira LOJA ÚNICA GLOBAL (espelhada)
-- =============================================================================
-- Mudança de modelo: os produtos da Conveniência Views deixam de pertencer a um
-- participante. Agora há UMA loja só; cada página de participante ESPELHA a
-- mesma vitrine. A atribuição "qual participante recebeu a compra" passa a ser
-- registrada no PEDIDO (casa_participant_product_order.id_participant), conforme
-- a página onde a compra aconteceu.
--
-- - Nova tabela global: casa_store_product (+ casa_store_product_media: galeria).
-- - O pedido repassa a referência de produto para a loja global.
-- - casa_participant_product (mig 110) fica órfã/sem uso (não removida p/ não
--   brigar com a FK do pedido em re-execuções de boot).
-- Idempotente.
-- =============================================================================

-- ─── Produto da loja global ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.casa_store_product (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(160) NOT NULL,
  description  TEXT,
  image_url    TEXT,                         -- capa (espelha a 1ª mídia)
  price_cents  BIGINT       NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  stock        INT          CHECK (stock IS NULL OR stock >= 0), -- NULL = ilimitado
  is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order   INT          NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_casa_store_product_active
  ON public.casa_store_product (is_active, sort_order);

-- ─── Galeria de mídia do produto (imagens) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.casa_store_product_media (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_product   UUID         NOT NULL REFERENCES public.casa_store_product(id) ON DELETE CASCADE,
  media_url    TEXT         NOT NULL,
  media_type   VARCHAR(20)  NOT NULL DEFAULT 'image' CHECK (media_type IN ('image','video')),
  thumbnail_url TEXT,
  sort_order   INT          NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_casa_store_media_product
  ON public.casa_store_product_media (id_product, sort_order);

-- ─── Repointar o pedido para a loja global ─────────────────────────────────
-- Remove a FK antiga (auto-nomeada, p/ casa_participant_product) e a recria
-- apontando para casa_store_product. Sem dados reais ainda (feature do dia).
ALTER TABLE public.casa_participant_product_order
  DROP CONSTRAINT IF EXISTS casa_participant_product_order_id_product_fkey;
ALTER TABLE public.casa_participant_product_order
  DROP CONSTRAINT IF EXISTS casa_order_product_global_fk;
ALTER TABLE public.casa_participant_product_order
  ADD CONSTRAINT casa_order_product_global_fk
  FOREIGN KEY (id_product) REFERENCES public.casa_store_product(id) ON DELETE RESTRICT;
