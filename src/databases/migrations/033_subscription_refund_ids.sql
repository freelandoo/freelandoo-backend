-- Migration 033: stripe_refund_id e stripe_charge_id em tb_profile_subscription
--
-- Persiste os identificadores do reembolso emitido pelo Stripe para que o ID
-- continue rastreável após reload da página de pagamentos. O charge é
-- guardado junto pra facilitar suporte (já temos a invoice indiretamente
-- via subscription, mas o charge é o que o Stripe Dashboard usa).
--
-- Idempotente.

ALTER TABLE public.tb_profile_subscription
  ADD COLUMN IF NOT EXISTS stripe_refund_id  TEXT,
  ADD COLUMN IF NOT EXISTS stripe_charge_id  TEXT;

CREATE INDEX IF NOT EXISTS ix_profile_subscription_refund_id
  ON public.tb_profile_subscription (stripe_refund_id)
  WHERE stripe_refund_id IS NOT NULL;
