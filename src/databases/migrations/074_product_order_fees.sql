-- =============================================================================
-- Migration 074: Fees no pedido de produto (governança da loja)
-- =============================================================================
-- Congela no order o valor que o vendedor recebe e as taxas no momento do
-- checkout. processor_fee_cents começa como estimado (fallback) e vira o
-- valor real do Stripe quando o webhook charge.succeeded chega.
-- =============================================================================

ALTER TABLE public.tb_profile_product_order
  ADD COLUMN IF NOT EXISTS seller_amount_cents       INT,
  ADD COLUMN IF NOT EXISTS service_fee_cents         INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processor_fee_cents       INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processor_fee_source      VARCHAR(20) NOT NULL DEFAULT 'fallback',
  ADD COLUMN IF NOT EXISTS processor_fee_settled_at  TIMESTAMPTZ;

ALTER TABLE public.tb_profile_product_order
  DROP CONSTRAINT IF EXISTS tb_profile_product_order_processor_src_chk;
ALTER TABLE public.tb_profile_product_order
  ADD CONSTRAINT tb_profile_product_order_processor_src_chk
  CHECK (processor_fee_source IN ('fallback','stripe_balance_tx','manual'));

CREATE INDEX IF NOT EXISTS idx_pp_order_processor_pending
  ON public.tb_profile_product_order (processor_fee_source, status)
  WHERE processor_fee_source = 'fallback';

-- ─── Backfill: pedidos antigos congelam seller_amount = total - shipping ────
-- (não tinha service_fee nem processor_fee separados antes; legacy fica 0 nesses
--  campos para não recalcular saldos já liquidados).
UPDATE public.tb_profile_product_order
   SET seller_amount_cents = GREATEST(0, COALESCE(total_cents, 0) - COALESCE(shipping_cents, 0))
 WHERE seller_amount_cents IS NULL;

ALTER TABLE public.tb_profile_product_order
  ALTER COLUMN seller_amount_cents SET NOT NULL;
