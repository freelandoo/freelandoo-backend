-- =============================================================================
-- Migration 000: Base Schema
-- Cria todas as tabelas core do sistema.
-- Seguro para rodar múltiplas vezes (IF NOT EXISTS em tudo).
-- DEVE ser rodado antes das migrations 001-005.
-- =============================================================================

-- =============================================================================
-- ROLES & STATUS (lookup tables)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_role (
  id_role    SERIAL PRIMARY KEY,
  desc_role  VARCHAR(80) NOT NULL UNIQUE,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID
);

CREATE TABLE IF NOT EXISTS public.tb_status (
  id_status   SERIAL PRIMARY KEY,
  desc_status VARCHAR(80) NOT NULL UNIQUE,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- USERS
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_user (
  id_user         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome            VARCHAR(160) NOT NULL,
  email           VARCHAR(254) NOT NULL UNIQUE,
  senha           TEXT NOT NULL,
  data_nascimento DATE,
  sexo            VARCHAR(20),
  ativo           BOOLEAN NOT NULL DEFAULT FALSE,
  avatar          TEXT,
  telefone        VARCHAR(30),
  bio             TEXT,
  estado          VARCHAR(2),
  municipio       VARCHAR(120),
  id_nicho        INTEGER,
  is_admin        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_tb_user_email ON public.tb_user (LOWER(TRIM(email)));

CREATE TABLE IF NOT EXISTS public.tb_user_activation (
  id_activation UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user       UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  token         TEXT NOT NULL UNIQUE,
  used          BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.tb_user_password_reset (
  id_reset   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user    UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  used       BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.tb_user_role (
  id_user   UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  id_role   INTEGER NOT NULL REFERENCES public.tb_role(id_role),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id_user, id_role)
);

CREATE TABLE IF NOT EXISTS public.tb_user_status (
  id_user    UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  id_status  INTEGER NOT NULL REFERENCES public.tb_status(id_status),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_user, id_status)
);

-- =============================================================================
-- CATEGORIES & TAXONOMY
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_category (
  id_category   SERIAL PRIMARY KEY,
  desc_category VARCHAR(120) NOT NULL,
  id_machine    INTEGER,  -- FK adicionada pela migration 003
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.tb_subcategory (
  id_subcategory   SERIAL PRIMARY KEY,
  id_category      INTEGER NOT NULL REFERENCES public.tb_category(id_category),
  desc_subcategory VARCHAR(120) NOT NULL,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- SOCIAL MEDIA TYPES & FOLLOWER RANGES
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_social_media_type (
  id_social_media_type SERIAL PRIMARY KEY,
  desc_social_media_type VARCHAR(60) NOT NULL UNIQUE,
  url                    TEXT,
  icon                   TEXT,
  is_active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.tb_follower_range (
  id_follower_range SERIAL PRIMARY KEY,
  follower_range    VARCHAR(60) NOT NULL UNIQUE,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- PROFILES
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_profile (
  id_profile   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user      UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  id_category  INTEGER NOT NULL REFERENCES public.tb_category(id_category),
  display_name VARCHAR(160),
  bio          TEXT,
  avatar_url   TEXT,
  estado       VARCHAR(2),
  municipio    VARCHAR(120),
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_tb_profile_user ON public.tb_profile (id_user);
CREATE INDEX IF NOT EXISTS ix_tb_profile_active ON public.tb_profile (is_active) WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS public.tb_profile_status (
  id_profile UUID NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_status  INTEGER NOT NULL REFERENCES public.tb_status(id_status),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_profile, id_status)
);

CREATE TABLE IF NOT EXISTS public.tb_profile_subcategory (
  id_profile     UUID NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_subcategory INTEGER NOT NULL REFERENCES public.tb_subcategory(id_subcategory),
  PRIMARY KEY (id_profile, id_subcategory)
);

CREATE TABLE IF NOT EXISTS public.tb_profile_social_media (
  id_profile_social_media UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_profile              UUID NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_social_media_type    INTEGER NOT NULL REFERENCES public.tb_social_media_type(id_social_media_type),
  url                     TEXT,
  id_follower_range       INTEGER REFERENCES public.tb_follower_range(id_follower_range),
  is_active               BOOLEAN NOT NULL DEFAULT TRUE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id_profile, id_social_media_type)
);

-- =============================================================================
-- PORTFOLIO
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_profile_portfolio_item (
  id_portfolio_item UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_profile        UUID NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  title             VARCHAR(200),
  description       TEXT,
  project_url       TEXT,
  is_featured       BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by        UUID,
  updated_by        UUID
);

CREATE TABLE IF NOT EXISTS public.tb_profile_portfolio_media (
  id_portfolio_media UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_portfolio_item  UUID NOT NULL REFERENCES public.tb_profile_portfolio_item(id_portfolio_item) ON DELETE CASCADE,
  media_url          TEXT NOT NULL,
  media_type         VARCHAR(20),
  thumbnail_url      TEXT,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by         UUID
);

-- =============================================================================
-- ITEMS (produtos compráveis)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_item (
  id_item            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  desc_item          VARCHAR(200) NOT NULL,
  details            TEXT,
  unity_price_cents  INTEGER NOT NULL DEFAULT 0,
  currency           VARCHAR(3) NOT NULL DEFAULT 'BRL',
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by         UUID,
  updated_by         UUID
);

-- =============================================================================
-- COUPONS
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_coupon (
  id_coupon          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code               VARCHAR(40) NOT NULL UNIQUE,
  discount_type      VARCHAR(16) NOT NULL,
  scope              VARCHAR(20) NOT NULL DEFAULT 'global',
  apply_mode         VARCHAR(20) NOT NULL DEFAULT 'automatic',
  max_discount_cents INTEGER,
  min_order_cents    INTEGER NOT NULL DEFAULT 0,
  value              NUMERIC(10,2) NOT NULL DEFAULT 0,
  owner_user_id      UUID REFERENCES public.tb_user(id_user),
  max_uses           INTEGER,
  applies_to_item_id UUID REFERENCES public.tb_item(id_item),
  expires_at         TIMESTAMPTZ,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by         UUID,
  updated_by         UUID,
  CONSTRAINT tb_coupon_discount_type_chk
    CHECK (discount_type IN ('percent', 'amount'))
);

CREATE INDEX IF NOT EXISTS ix_tb_coupon_code ON public.tb_coupon (UPPER(code));
CREATE INDEX IF NOT EXISTS ix_tb_coupon_owner ON public.tb_coupon (owner_user_id) WHERE is_active = TRUE;

-- =============================================================================
-- CHECKOUT
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_checkout (
  id_checkout    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user        UUID NOT NULL REFERENCES public.tb_user(id_user),
  id_profile     UUID REFERENCES public.tb_profile(id_profile),
  status         VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  currency       VARCHAR(3) NOT NULL DEFAULT 'BRL',
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  total_cents    INTEGER NOT NULL DEFAULT 0,
  expires_at     TIMESTAMPTZ,
  approved_at    TIMESTAMPTZ,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.tb_checkout_item (
  id_checkout_item           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_checkout                UUID NOT NULL REFERENCES public.tb_checkout(id_checkout) ON DELETE CASCADE,
  id_item                    UUID NOT NULL REFERENCES public.tb_item(id_item),
  item_name_snapshot         VARCHAR(200),
  unit_price_cents_snapshot  INTEGER NOT NULL DEFAULT 0,
  quantity                   INTEGER NOT NULL DEFAULT 1,
  total_cents                INTEGER NOT NULL DEFAULT 0,
  discount_cents             INTEGER NOT NULL DEFAULT 0,
  is_active                  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.tb_checkout_coupon (
  id_checkout_coupon UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_checkout        UUID NOT NULL REFERENCES public.tb_checkout(id_checkout) ON DELETE CASCADE,
  id_coupon          UUID NOT NULL REFERENCES public.tb_coupon(id_coupon),
  code_snapshot      VARCHAR(40),
  discount_cents     INTEGER NOT NULL DEFAULT 0,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- ORDERS
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_order (
  id_order              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user               UUID NOT NULL REFERENCES public.tb_user(id_user),
  id_profile            UUID REFERENCES public.tb_profile(id_profile),
  id_checkout           UUID REFERENCES public.tb_checkout(id_checkout),
  status                VARCHAR(30) NOT NULL DEFAULT 'PENDING_PAYMENT',
  subtotal_cents        INTEGER NOT NULL DEFAULT 0,
  total_cents           INTEGER NOT NULL DEFAULT 0,
  currency              VARCHAR(3) NOT NULL DEFAULT 'BRL',
  payment_provider      VARCHAR(40),
  payment_provider_ref  TEXT,
  payment_url           TEXT,
  expires_at            TIMESTAMPTZ,
  approved_at           TIMESTAMPTZ,
  paid_at               TIMESTAMPTZ,
  raw_webhook           JSONB,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tb_order_status_chk
    CHECK (status IN ('PENDING_PAYMENT', 'PAID', 'COMPLETED', 'CANCELLED', 'CANCELED', 'EXPIRED'))
);

CREATE INDEX IF NOT EXISTS ix_tb_order_user ON public.tb_order (id_user, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_tb_order_status ON public.tb_order (status);

CREATE TABLE IF NOT EXISTS public.tb_order_item (
  id_order_item              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_order                   UUID NOT NULL REFERENCES public.tb_order(id_order) ON DELETE CASCADE,
  id_item                    UUID NOT NULL REFERENCES public.tb_item(id_item),
  item_name_snapshot         VARCHAR(200),
  unit_price_cents_snapshot  INTEGER NOT NULL DEFAULT 0,
  quantity                   INTEGER NOT NULL DEFAULT 1,
  total_cents                INTEGER NOT NULL DEFAULT 0,
  discount_cents             INTEGER NOT NULL DEFAULT 0,
  is_active                  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by                 UUID,
  updated_by                 UUID
);

CREATE TABLE IF NOT EXISTS public.tb_order_coupon (
  id_order_coupon UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_order        UUID NOT NULL REFERENCES public.tb_order(id_order) ON DELETE CASCADE,
  id_coupon       UUID NOT NULL REFERENCES public.tb_coupon(id_coupon),
  code_snapshot   VARCHAR(40),
  discount_cents  INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID,
  updated_by      UUID
);

-- =============================================================================
-- PAYMENTS (tabela usada pelo PaymentController — Mercado Pago)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.payments (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL REFERENCES public.tb_user(id_user),
  provider               VARCHAR(40) NOT NULL DEFAULT 'mercadopago',
  provider_preference_id TEXT,
  provider_payment_id    TEXT,
  type                   VARCHAR(40) NOT NULL DEFAULT 'activation_fee',
  status                 VARCHAR(20) NOT NULL DEFAULT 'pending',
  amount_cents           INTEGER NOT NULL DEFAULT 0,
  currency               VARCHAR(3) NOT NULL DEFAULT 'BRL',
  approved_at            TIMESTAMPTZ,
  raw_webhook            JSONB,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_payments_user ON public.payments (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_payments_status ON public.payments (status);

-- =============================================================================
-- LEGAL DOCUMENTS
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_legal_document (
  id_legal_document UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version           VARCHAR(20) NOT NULL,
  document_type     VARCHAR(40) NOT NULL,
  title             VARCHAR(200),
  content           TEXT,
  document_hash     TEXT,
  published_at      TIMESTAMPTZ,
  published_by      UUID,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- SEEDS: dados de referência iniciais
-- =============================================================================

-- Roles
INSERT INTO public.tb_role (desc_role) VALUES
  ('Administrator'),
  ('Moderator'),
  ('Creator')
ON CONFLICT (desc_role) DO NOTHING;

-- Statuses
INSERT INTO public.tb_status (desc_status) VALUES
  ('active'),
  ('inactive'),
  ('pending'),
  ('suspended'),
  ('fee_paid'),
  ('premium')
ON CONFLICT (desc_status) DO NOTHING;

-- Social Media Types
INSERT INTO public.tb_social_media_type (desc_social_media_type, url, icon) VALUES
  ('Instagram',  'https://instagram.com/',  'instagram'),
  ('TikTok',     'https://tiktok.com/@',    'tiktok'),
  ('YouTube',    'https://youtube.com/',    'youtube'),
  ('Facebook',   'https://facebook.com/',   'facebook'),
  ('Twitter/X',  'https://x.com/',          'twitter'),
  ('LinkedIn',   'https://linkedin.com/in/','linkedin'),
  ('Pinterest',  'https://pinterest.com/',  'pinterest'),
  ('Twitch',     'https://twitch.tv/',      'twitch')
ON CONFLICT (desc_social_media_type) DO NOTHING;

-- Follower Ranges
INSERT INTO public.tb_follower_range (follower_range) VALUES
  ('Até 1 mil'),
  ('1 mil - 10 mil'),
  ('10 mil - 50 mil'),
  ('50 mil - 100 mil'),
  ('100 mil - 500 mil'),
  ('500 mil - 1 milhão'),
  ('Acima de 1 milhão')
ON CONFLICT (follower_range) DO NOTHING;
