-- Migration 032: refunded_at em tb_profile_subscription
--
-- Marca o instante em que o reembolso foi emitido pelo usuário (dentro dos 7
-- dias corridos do CDC). O status permanece 'canceled'; este campo distingue
-- cancelamentos normais de reembolsos para fins de relatório.
--
-- Idempotente.

ALTER TABLE public.tb_profile_subscription
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS ix_profile_subscription_refunded
  ON public.tb_profile_subscription (refunded_at)
  WHERE refunded_at IS NOT NULL;
