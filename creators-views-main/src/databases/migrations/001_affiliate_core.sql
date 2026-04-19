-- Migration 001: Affiliate core tables
-- Phase 2 of the affiliate spec. Safe to run multiple times (IF NOT EXISTS everywhere).

-- =============================================================================
-- tb_affiliate — opt-in that promotes a user to affiliate
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.tb_affiliate (
  id_affiliate       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user            UUID NOT NULL UNIQUE REFERENCES public.tb_user(id_user),
  status             VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  pix_key            VARCHAR(160),
  pix_key_type       VARCHAR(20),
  legal_name         VARCHAR(160),
  tax_id             VARCHAR(32),
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by         UUID,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by         UUID,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT tb_affiliate_status_chk
    CHECK (status IN ('ACTIVE', 'PAUSED', 'BLOCKED'))
);

CREATE INDEX IF NOT EXISTS ix_tb_affiliate_status
  ON public.tb_affiliate (status) WHERE is_active = TRUE;

-- =============================================================================
-- tb_affiliate_settings — global commission rules, versioned (never UPDATE in place)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.tb_affiliate_settings (
  id_settings                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  default_commission_percent NUMERIC(5,2) NOT NULL,
  commission_base            VARCHAR(20)  NOT NULL DEFAULT 'NET_OF_DISCOUNT',
  min_order_cents            INTEGER      NOT NULL DEFAULT 0,
  max_commission_cents       INTEGER,
  approval_delay_days        INTEGER      NOT NULL DEFAULT 30,
  effective_from             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  notes                      TEXT,
  created_at                 TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_by                 UUID,
  CONSTRAINT tb_affiliate_settings_base_chk
    CHECK (commission_base IN ('GROSS', 'NET_OF_DISCOUNT')),
  CONSTRAINT tb_affiliate_settings_percent_chk
    CHECK (default_commission_percent >= 0 AND default_commission_percent <= 100)
);

CREATE INDEX IF NOT EXISTS ix_tb_affiliate_settings_effective
  ON public.tb_affiliate_settings (effective_from DESC);

-- =============================================================================
-- tb_affiliate_coupon_override — per-coupon override of the global rule
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.tb_affiliate_coupon_override (
  id_override          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_coupon            UUID NOT NULL UNIQUE REFERENCES public.tb_coupon(id_coupon),
  commission_percent   NUMERIC(5,2),
  commission_base      VARCHAR(20),
  max_commission_cents INTEGER,
  approval_delay_days  INTEGER,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by           UUID,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by           UUID,
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT tb_affiliate_coupon_override_base_chk
    CHECK (commission_base IS NULL OR commission_base IN ('GROSS', 'NET_OF_DISCOUNT')),
  CONSTRAINT tb_affiliate_coupon_override_percent_chk
    CHECK (commission_percent IS NULL OR (commission_percent >= 0 AND commission_percent <= 100))
);

-- =============================================================================
-- tb_affiliate_conversion — 1:1 with tb_order_coupon when coupon owner is affiliate
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.tb_affiliate_conversion (
  id_conversion          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_affiliate           UUID NOT NULL REFERENCES public.tb_affiliate(id_affiliate),
  id_order               UUID NOT NULL REFERENCES public.tb_order(id_order),
  id_order_coupon        UUID NOT NULL UNIQUE REFERENCES public.tb_order_coupon(id_order_coupon),
  id_coupon              UUID NOT NULL REFERENCES public.tb_coupon(id_coupon),
  status                 VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  order_total_cents      INTEGER NOT NULL,
  discount_cents         INTEGER NOT NULL,
  commission_base_cents  INTEGER NOT NULL,
  commission_percent     NUMERIC(5,2) NOT NULL,
  commission_cents       INTEGER NOT NULL,
  rule_snapshot          JSONB NOT NULL,
  eligible_at            TIMESTAMPTZ,
  approved_at            TIMESTAMPTZ,
  reversed_at            TIMESTAMPTZ,
  paid_at                TIMESTAMPTZ,
  reversal_reason        TEXT,
  id_payout_item         UUID,
  disputed               BOOLEAN NOT NULL DEFAULT FALSE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tb_affiliate_conversion_status_chk
    CHECK (status IN ('PENDING', 'APPROVED', 'REVERSED', 'PAID'))
);

CREATE INDEX IF NOT EXISTS ix_tb_affiliate_conversion_affiliate_status
  ON public.tb_affiliate_conversion (id_affiliate, status);

CREATE INDEX IF NOT EXISTS ix_tb_affiliate_conversion_eligible
  ON public.tb_affiliate_conversion (status, eligible_at)
  WHERE id_payout_item IS NULL;

CREATE INDEX IF NOT EXISTS ix_tb_affiliate_conversion_order
  ON public.tb_affiliate_conversion (id_order);

-- =============================================================================
-- tb_affiliate_conversion_event — idempotência de eventos MP que tocam conversão
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.tb_affiliate_conversion_event (
  id_event        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_conversion   UUID NOT NULL REFERENCES public.tb_affiliate_conversion(id_conversion),
  source          VARCHAR(40) NOT NULL,          -- 'mp_webhook' | 'order_status' | 'admin_manual'
  source_event_id VARCHAR(120) NOT NULL,         -- MP payment id + status, admin log id, etc.
  from_status     VARCHAR(20),
  to_status       VARCHAR(20) NOT NULL,
  payload         JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tb_affiliate_conversion_event_src_uq
    UNIQUE (source, source_event_id)
);

CREATE INDEX IF NOT EXISTS ix_tb_affiliate_conversion_event_conv
  ON public.tb_affiliate_conversion_event (id_conversion, created_at DESC);

-- =============================================================================
-- tb_affiliate_payout_batch + tb_affiliate_payout_item (Phase 4, tabelas criadas
-- desde já pra a FK em tb_affiliate_conversion.id_payout_item fazer sentido)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.tb_affiliate_payout_batch (
  id_batch          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_affiliate      UUID NOT NULL REFERENCES public.tb_affiliate(id_affiliate),
  period_start      DATE,
  period_end        DATE NOT NULL,
  total_cents       INTEGER NOT NULL DEFAULT 0,
  status            VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  pix_key_snapshot  VARCHAR(160),
  receipt_url       TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by        UUID,
  paid_at           TIMESTAMPTZ,
  paid_by           UUID,
  CONSTRAINT tb_affiliate_payout_batch_status_chk
    CHECK (status IN ('DRAFT', 'SENT', 'PAID', 'CANCELED', 'FAILED'))
);

CREATE TABLE IF NOT EXISTS public.tb_affiliate_payout_item (
  id_item          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_batch         UUID NOT NULL REFERENCES public.tb_affiliate_payout_batch(id_batch),
  id_conversion    UUID NOT NULL UNIQUE REFERENCES public.tb_affiliate_conversion(id_conversion),
  commission_cents INTEGER NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- FK tardia em tb_affiliate_conversion.id_payout_item (agora que a tabela existe)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'tb_affiliate_conversion_payout_item_fk'
  ) THEN
    ALTER TABLE public.tb_affiliate_conversion
    ADD CONSTRAINT tb_affiliate_conversion_payout_item_fk
    FOREIGN KEY (id_payout_item) REFERENCES public.tb_affiliate_payout_item(id_item);
  END IF;
END $$;

-- =============================================================================
-- tb_affiliate_audit_log — mudanças de regra, overrides, reversões manuais
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.tb_affiliate_audit_log (
  id_log          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity          VARCHAR(40) NOT NULL,
  entity_id       UUID,
  action          VARCHAR(40) NOT NULL,
  before_state    JSONB,
  after_state     JSONB,
  reason          TEXT,
  actor_user_id   UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_tb_affiliate_audit_entity
  ON public.tb_affiliate_audit_log (entity, entity_id, created_at DESC);
