-- =============================================================================
-- Migration 123: Gating do repasse pela proteção
-- =============================================================================
-- Liga os ledgers existentes ao caso de proteção. O payout passa a ser ARMADO
-- só quando protection_case.state='clear' (com available_at = cleared_at + 8d),
-- em vez de no pagamento. Disputa aberta = payout não nasce / fica congelado.
--
-- A coluna é nullable e os ledgers antigos são religados ao caso retroativo
-- criado no backfill da mig 120. Idempotente.
-- =============================================================================

ALTER TABLE public.tb_seller_balance
  ADD COLUMN IF NOT EXISTS protection_case_id BIGINT REFERENCES public.tb_protection_case(id);

ALTER TABLE public.tb_booking_payout
  ADD COLUMN IF NOT EXISTS protection_case_id BIGINT REFERENCES public.tb_protection_case(id);

CREATE INDEX IF NOT EXISTS idx_seller_balance_protection
  ON public.tb_seller_balance (protection_case_id);

CREATE INDEX IF NOT EXISTS idx_booking_payout_protection
  ON public.tb_booking_payout (protection_case_id);

-- Religa ledgers existentes ao caso retroativo (backfill mig 120).
UPDATE public.tb_seller_balance b
   SET protection_case_id = c.id
  FROM public.tb_protection_case c
 WHERE c.domain = 'product' AND c.ref_id = b.id_order
   AND b.protection_case_id IS NULL;

UPDATE public.tb_booking_payout p
   SET protection_case_id = c.id
  FROM public.tb_protection_case c
 WHERE c.domain = 'booking' AND c.ref_id = p.id_booking
   AND p.protection_case_id IS NULL;
