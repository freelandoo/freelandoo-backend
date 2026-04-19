-- Migration 005: regra GERAL de desconto de cupom + OVERRIDE por cupom
-- Safe to run multiple times (IF NOT EXISTS).
-- Observação: comissão geral reusa tb_affiliate_settings (migration 001)
-- e override de comissão por cupom reusa tb_affiliate_coupon_override (migration 001).

-- =============================================================================
-- tb_coupon_discount_settings — regra geral de desconto (singleton lógico)
-- Guardamos versões (linhas com effective_from DESC). A regra atual é a última.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.tb_coupon_discount_settings (
  id_settings         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discount_type       VARCHAR(16) NOT NULL,
  discount_value      NUMERIC(10,2) NOT NULL,
  max_discount_cents  INTEGER,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  effective_from      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          UUID,
  CONSTRAINT tb_coupon_discount_settings_type_chk
    CHECK (discount_type IN ('percent', 'amount')),
  CONSTRAINT tb_coupon_discount_settings_value_chk
    CHECK (discount_value >= 0),
  CONSTRAINT tb_coupon_discount_settings_percent_chk
    CHECK (discount_type <> 'percent' OR (discount_value >= 0 AND discount_value <= 100))
);

CREATE INDEX IF NOT EXISTS ix_tb_coupon_discount_settings_effective
  ON public.tb_coupon_discount_settings (effective_from DESC);

-- Seed inicial conservador (desativado até admin configurar)
INSERT INTO public.tb_coupon_discount_settings
  (discount_type, discount_value, max_discount_cents, is_active, notes)
SELECT 'percent', 0, NULL, FALSE, 'Seed inicial. Configure via admin.'
WHERE NOT EXISTS (SELECT 1 FROM public.tb_coupon_discount_settings);

-- =============================================================================
-- tb_coupon_discount_override — desconto específico por cupom (sobrescreve geral)
-- Espelha o padrão de tb_affiliate_coupon_override.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.tb_coupon_discount_override (
  id_override         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_coupon           UUID NOT NULL UNIQUE REFERENCES public.tb_coupon(id_coupon),
  discount_type       VARCHAR(16),
  discount_value      NUMERIC(10,2),
  max_discount_cents  INTEGER,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          UUID,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by          UUID,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT tb_coupon_discount_override_type_chk
    CHECK (discount_type IS NULL OR discount_type IN ('percent', 'amount')),
  CONSTRAINT tb_coupon_discount_override_value_chk
    CHECK (discount_value IS NULL OR discount_value >= 0),
  CONSTRAINT tb_coupon_discount_override_percent_chk
    CHECK (discount_type IS NULL OR discount_type <> 'percent' OR discount_value IS NULL OR (discount_value >= 0 AND discount_value <= 100))
);

CREATE INDEX IF NOT EXISTS ix_tb_coupon_discount_override_coupon
  ON public.tb_coupon_discount_override (id_coupon) WHERE is_active = TRUE;
