-- =============================================================================
-- Migration 075: Profile Subscription — anuidade vira ATIVAÇÃO ÚNICA (one-time)
-- =============================================================================
-- Conceito: R$ 300 por perfil é uma TAXA DE ATIVAÇÃO única, sem renovação anual.
--
-- Mudanças:
-- 1) current_period_start/end ficam nullable (não fazem mais sentido em one-time).
-- 2) stripe_subscription_id fica nullable (não usado em one-time payment).
-- 3) Lifetime grant: subscriptions que estão 'active' hoje viram vitalícias
--    (current_period_end = NULL, canceled_at = NULL) — decisão (a) do Alex.
--    Os auto-renew no Stripe precisam ser cancelados manualmente (script à parte).
-- 4) Mantém-se a tabela e o enum status; semântica nova:
--      pending  — checkout iniciado
--      active   — pago (vitalício)
--      expired  — pós-reembolso
--      canceled — admin cancelou manualmente
--      (past_due / failed continuam no enum mas não serão usados para one-time)
-- =============================================================================

ALTER TABLE public.tb_profile_subscription
  ALTER COLUMN current_period_start DROP NOT NULL,
  ALTER COLUMN current_period_end   DROP NOT NULL,
  ALTER COLUMN stripe_subscription_id DROP NOT NULL,
  ALTER COLUMN stripe_price_id        DROP NOT NULL;

-- Stripe Payment Intent ID para pagamentos one-time (subscription ID fica NULL nesses casos).
ALTER TABLE public.tb_profile_subscription
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT;

-- Lifetime grant: assinaturas ativas ganham vitalício de graça.
-- current_period_end = NULL sinaliza "sem fim" (vitalício).
-- canceled_at é zerado (mesmo que estivesse com cancel_at_period_end).
UPDATE public.tb_profile_subscription
   SET current_period_end = NULL,
       current_period_start = COALESCE(current_period_start, paid_at, NOW()),
       canceled_at = NULL,
       updated_at = NOW()
 WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_profile_subscription_pi
  ON public.tb_profile_subscription (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

COMMENT ON COLUMN public.tb_profile_subscription.current_period_end IS
  'NULL = ativação vitalícia (one-time). Valor preenchido apenas em subscriptions legacy ainda recorrentes.';
COMMENT ON COLUMN public.tb_profile_subscription.stripe_subscription_id IS
  'NULL em pagamentos one-time. Populado apenas em subscriptions legacy.';
COMMENT ON COLUMN public.tb_profile_subscription.stripe_payment_intent_id IS
  'Payment Intent ID para pagamentos one-time. NULL em subscriptions legacy.';
