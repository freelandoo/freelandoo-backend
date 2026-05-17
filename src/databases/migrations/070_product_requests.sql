-- =============================================================================
-- Migration 070: Product Requests — "Pedir Produto" (mural de compradores)
-- =============================================================================
-- Análogo a tb_service_request (mig 023), mas para produtos físicos.
-- Comprador escolhe categoria + cidade/estado + descrição; opcional faixa de
-- preço e imagem de referência. Pedido vai para o mural dos subperfis pagos
-- compatíveis (matching no slice 3).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_product_request (
  id_product_request    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_buyer_user         UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  id_product_category   INT          NOT NULL REFERENCES public.tb_product_category(id_product_category) ON DELETE RESTRICT,
  title                 VARCHAR(160) NOT NULL,
  description           TEXT         NOT NULL,
  city                  VARCHAR(120) NOT NULL,
  state                 VARCHAR(2)   NOT NULL,
  min_price_cents       INT          CHECK (min_price_cents IS NULL OR min_price_cents >= 0),
  max_price_cents       INT          CHECK (max_price_cents IS NULL OR max_price_cents >= 0),
  reference_image_url   TEXT,
  reference_image_key   TEXT,
  status                VARCHAR(16)  NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open','answered','negotiating','closed','canceled','expired')),
  answered_at           TIMESTAMPTZ,
  closed_at             TIMESTAMPTZ,
  canceled_at           TIMESTAMPTZ,
  expired_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_request_buyer
  ON public.tb_product_request (id_buyer_user, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_request_mural
  ON public.tb_product_request (status, id_product_category, state, city, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_request_category
  ON public.tb_product_request (id_product_category, status);
