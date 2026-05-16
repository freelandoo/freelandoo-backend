-- =============================================================================
-- Migration 063: Profile Products — loja de produtos físicos por subperfil
-- =============================================================================
-- Espelha estrutura de tb_profile_service / tb_profile_service_media
-- Adiciona campos específicos de produto físico: estoque, peso, dimensões e
-- CEP de origem (override opcional do CEP do subperfil — vem na mig 063b /
-- coluna tb_profile.origin_zipcode).
-- Somente subperfis com assinatura ativa (tb_profile_subscription.status='active')
-- podem ter produtos publicados/ativos — validação feita no service layer.
-- =============================================================================

-- ─── CEP de origem padrão do subperfil ─────────────────────────────────────────
ALTER TABLE public.tb_profile
  ADD COLUMN IF NOT EXISTS origin_zipcode VARCHAR(8);

COMMENT ON COLUMN public.tb_profile.origin_zipcode IS
  'CEP padrão (apenas dígitos) usado como origem de frete para todos os produtos da loja deste subperfil. Pode ser sobrescrito por produto via tb_profile_product.origin_zipcode_override.';

-- ─── Tabela de produtos ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_profile_product (
  id_profile_product       BIGSERIAL    PRIMARY KEY,
  id_profile               UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  name                     VARCHAR(160) NOT NULL,
  description              TEXT,
  price_amount             INT          NOT NULL DEFAULT 0  CHECK (price_amount >= 0), -- centavos
  currency                 VARCHAR(3)   NOT NULL DEFAULT 'BRL',
  stock_quantity           INT          NOT NULL DEFAULT 0  CHECK (stock_quantity >= 0),
  weight_grams             INT          NOT NULL DEFAULT 0  CHECK (weight_grams >= 0),
  height_cm                NUMERIC(8,2) NOT NULL DEFAULT 0  CHECK (height_cm >= 0),
  width_cm                 NUMERIC(8,2) NOT NULL DEFAULT 0  CHECK (width_cm >= 0),
  length_cm                NUMERIC(8,2) NOT NULL DEFAULT 0  CHECK (length_cm >= 0),
  origin_zipcode_override  VARCHAR(8),
  is_active                BOOLEAN      NOT NULL DEFAULT TRUE,
  deleted_at               TIMESTAMPTZ,
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profile_product_profile
  ON public.tb_profile_product (id_profile)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_profile_product_active
  ON public.tb_profile_product (id_profile, is_active)
  WHERE deleted_at IS NULL;

-- ─── Mídias do produto ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_profile_product_media (
  id_product_media    BIGSERIAL       PRIMARY KEY,
  id_profile_product  BIGINT          NOT NULL REFERENCES public.tb_profile_product(id_profile_product) ON DELETE CASCADE,
  id_profile          UUID            NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  media_url           TEXT            NOT NULL,
  media_type          VARCHAR(20)     NOT NULL CHECK (media_type IN ('image','video')),
  thumbnail_url       TEXT,
  storage_key         TEXT,
  thumbnail_key       TEXT,
  original_filename   TEXT,
  mime_type           VARCHAR(100),
  width               INTEGER,
  height              INTEGER,
  size_bytes          INTEGER,
  duration_seconds    NUMERIC,
  sort_order          INTEGER         NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_media_product
  ON public.tb_profile_product_media (id_profile_product);

CREATE INDEX IF NOT EXISTS idx_product_media_profile
  ON public.tb_profile_product_media (id_profile);
