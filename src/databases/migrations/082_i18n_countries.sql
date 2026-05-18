-- =============================================================================
-- Migration 082: i18n — Países + preferências de locale/país do usuário
-- =============================================================================
-- Adiciona suporte multi-idioma (pt-BR, en, es) e multi-país (BR padrão).
-- Cria catálogo de países (tb_country) com seed inicial. Adiciona
-- preferred_locale + preferred_country em tb_user e country (default 'BR') em
-- entidades-chave para permitir filtro por país: profile, product_request,
-- service_request, profile_product, profile_service, portfolio_item.
--
-- Tudo idempotente. Backfill default 'BR' para preservar comportamento atual.
-- =============================================================================

-- =============================================================================
-- 1. Catálogo de países
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.tb_country (
  iso2            VARCHAR(2)   PRIMARY KEY,
  iso3            VARCHAR(3),
  name_pt         VARCHAR(120) NOT NULL,
  name_en         VARCHAR(120) NOT NULL,
  name_es         VARCHAR(120) NOT NULL,
  default_locale  VARCHAR(8)   NOT NULL DEFAULT 'pt-BR',
  currency        VARCHAR(3)   NOT NULL DEFAULT 'BRL',
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  display_order   INT          NOT NULL DEFAULT 100,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_country_active
  ON public.tb_country (is_active, display_order, name_pt);

-- Seed inicial
INSERT INTO public.tb_country (iso2, iso3, name_pt, name_en, name_es, default_locale, currency, display_order)
VALUES
  ('BR', 'BRA', 'Brasil',          'Brazil',         'Brasil',         'pt-BR', 'BRL', 1),
  ('US', 'USA', 'Estados Unidos',  'United States',  'Estados Unidos', 'en',    'USD', 2),
  ('ES', 'ESP', 'Espanha',         'Spain',          'España',         'es',    'EUR', 3),
  ('MX', 'MEX', 'México',          'Mexico',         'México',         'es',    'MXN', 4),
  ('PT', 'PRT', 'Portugal',        'Portugal',       'Portugal',       'pt-BR', 'EUR', 5),
  ('AR', 'ARG', 'Argentina',       'Argentina',      'Argentina',      'es',    'ARS', 6),
  ('CL', 'CHL', 'Chile',           'Chile',          'Chile',          'es',    'CLP', 7),
  ('CO', 'COL', 'Colômbia',        'Colombia',       'Colombia',       'es',    'COP', 8),
  ('PE', 'PER', 'Peru',            'Peru',           'Perú',           'es',    'PEN', 9),
  ('UY', 'URY', 'Uruguai',         'Uruguay',        'Uruguay',        'es',    'UYU', 10),
  ('CA', 'CAN', 'Canadá',          'Canada',         'Canadá',         'en',    'CAD', 11),
  ('GB', 'GBR', 'Reino Unido',     'United Kingdom', 'Reino Unido',    'en',    'GBP', 12)
ON CONFLICT (iso2) DO NOTHING;

-- =============================================================================
-- 2. Preferências do usuário
-- =============================================================================
ALTER TABLE public.tb_user
  ADD COLUMN IF NOT EXISTS preferred_locale  VARCHAR(8),
  ADD COLUMN IF NOT EXISTS preferred_country VARCHAR(2);

-- CHECK constraints (drop antes de add — idempotente)
ALTER TABLE public.tb_user DROP CONSTRAINT IF EXISTS chk_user_preferred_locale;
ALTER TABLE public.tb_user
  ADD CONSTRAINT chk_user_preferred_locale
  CHECK (preferred_locale IS NULL OR preferred_locale IN ('pt-BR', 'en', 'es'));

ALTER TABLE public.tb_user DROP CONSTRAINT IF EXISTS fk_user_preferred_country;
ALTER TABLE public.tb_user
  ADD CONSTRAINT fk_user_preferred_country
  FOREIGN KEY (preferred_country) REFERENCES public.tb_country(iso2) ON DELETE SET NULL;

-- =============================================================================
-- 3. Coluna country em entidades-chave (todas default 'BR' p/ backfill)
-- =============================================================================

-- tb_profile (subperfis e clans)
ALTER TABLE public.tb_profile
  ADD COLUMN IF NOT EXISTS country VARCHAR(2) NOT NULL DEFAULT 'BR';

CREATE INDEX IF NOT EXISTS idx_profile_country
  ON public.tb_profile (country)
  WHERE deleted_at IS NULL;

-- tb_product_request (mural de pedidos)
ALTER TABLE public.tb_product_request
  ADD COLUMN IF NOT EXISTS country VARCHAR(2) NOT NULL DEFAULT 'BR';

CREATE INDEX IF NOT EXISTS idx_product_request_country_mural
  ON public.tb_product_request (country, status, id_product_category, created_at DESC);

-- tb_service_request (mural de serviços) — só se a tabela existir
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tb_service_request') THEN
    EXECUTE 'ALTER TABLE public.tb_service_request ADD COLUMN IF NOT EXISTS country VARCHAR(2) NOT NULL DEFAULT ''BR''';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_service_request_country ON public.tb_service_request (country, created_at DESC)';
  END IF;
END $$;

-- tb_profile_product (produtos da loja)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tb_profile_product') THEN
    EXECUTE 'ALTER TABLE public.tb_profile_product ADD COLUMN IF NOT EXISTS country VARCHAR(2) NOT NULL DEFAULT ''BR''';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_profile_product_country ON public.tb_profile_product (country, created_at DESC)';
  END IF;
END $$;

-- tb_profile_service (serviços)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tb_profile_service') THEN
    EXECUTE 'ALTER TABLE public.tb_profile_service ADD COLUMN IF NOT EXISTS country VARCHAR(2) NOT NULL DEFAULT ''BR''';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_profile_service_country ON public.tb_profile_service (country)';
  END IF;
END $$;

-- tb_profile_portfolio_item (posts do feed/bees)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tb_profile_portfolio_item') THEN
    EXECUTE 'ALTER TABLE public.tb_profile_portfolio_item ADD COLUMN IF NOT EXISTS country VARCHAR(2) NOT NULL DEFAULT ''BR''';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_portfolio_item_country ON public.tb_profile_portfolio_item (country, created_at DESC) WHERE is_banned = FALSE';
  END IF;
END $$;

-- =============================================================================
-- 4. FK opcional: country aponta pra tb_country (validação leve)
-- =============================================================================
-- Não criamos FK obrigatória pra evitar quebrar inserts existentes sem país.
-- Validação fica no application layer.
