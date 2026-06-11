-- =============================================================================
-- Migration 143: Fixes da auditoria de pagamentos (2026-06-11)
-- =============================================================================
-- 1) course_enrollments ganha refs Stripe + fee da plataforma + refunded_at:
--    - refs permitem localizar a matrícula no charge.refunded (curso TEM
--      reembolso de 7 dias — CDC);
--    - fee_cents persiste a taxa de serviço da plataforma na venda,
--      que passa a aparecer nas Entradas do admin como 'comissao_curso'.
-- 2) polen_purchases.status ganha 'refunded' (chargeback/estorno manual via
--    Stripe — política segue SEM reembolso voluntário, mas o evento precisa
--    marcar a compra e clawback dos Poléns).
--    O clawback pode deixar o saldo negativo se o usuário já gastou os Poléns.
-- 3) Índice ÚNICO em tb_order (payment_provider, payment_provider_ref):
--    a idempotência das conversões de afiliado era só SELECT-antes-de-INSERT;
--    com Pix (eventos assíncronos) a janela de corrida cresce. Verificado em
--    2026-06-11: zero duplicatas em produção.

ALTER TABLE public.course_enrollments
  ADD COLUMN IF NOT EXISTS stripe_session_id     TEXT,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent TEXT,
  ADD COLUMN IF NOT EXISTS fee_cents             INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_cents           INT,
  ADD COLUMN IF NOT EXISTS refunded_at           TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS ix_course_enrollments_payment_intent
  ON public.course_enrollments (stripe_payment_intent)
  WHERE stripe_payment_intent IS NOT NULL;

ALTER TABLE public.polen_purchases
  DROP CONSTRAINT IF EXISTS polen_purchases_status_check;

ALTER TABLE public.polen_purchases
  ADD CONSTRAINT polen_purchases_status_check
  CHECK (status IN ('pending','paid','failed','expired','refunded'));

CREATE INDEX IF NOT EXISTS ix_polen_purchases_payment_intent
  ON public.polen_purchases (stripe_payment_intent)
  WHERE stripe_payment_intent IS NOT NULL;

ALTER TABLE public.polen_wallets
  DROP CONSTRAINT IF EXISTS polen_wallets_nonnegative;

ALTER TABLE public.polen_wallets
  ADD CONSTRAINT polen_wallets_lifetime_nonnegative
  CHECK (lifetime_earned >= 0 AND lifetime_spent >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS ux_tb_order_provider_ref
  ON public.tb_order (payment_provider, payment_provider_ref)
  WHERE payment_provider_ref IS NOT NULL;
