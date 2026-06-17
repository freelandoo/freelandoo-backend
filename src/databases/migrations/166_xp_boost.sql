-- =============================================================================
-- Migration 166: Booster de XP (nível 5) — compras
-- =============================================================================
-- Produto único (R$10) vendido na loja de poléns que leva um subperfil escolhido
-- direto ao nível-alvo (5). Pago via Stripe (price_data ad-hoc), sem comissão de
-- afiliado, sem reembolso automático (refunded_at reservado). A entrega credita
-- um evento de XP idempotente (source_id = stripe_session_id) e recalcula o nível.
-- Espelha polen_purchases. Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.xp_boost_purchases (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  id_profile               UUID NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  target_level             INTEGER NOT NULL DEFAULT 5,
  status                   TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','paid','failed','expired')),
  amount_cents             INTEGER NOT NULL CHECK (amount_cents > 0),
  xp_granted               NUMERIC NOT NULL DEFAULT 0,
  stripe_session_id        TEXT,
  stripe_payment_intent    TEXT,
  paid_at                  TIMESTAMPTZ,
  refunded_at              TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_xp_boost_purchases_session
  ON public.xp_boost_purchases (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_xp_boost_purchases_user
  ON public.xp_boost_purchases (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_xp_boost_purchases_pi
  ON public.xp_boost_purchases (stripe_payment_intent)
  WHERE stripe_payment_intent IS NOT NULL;
