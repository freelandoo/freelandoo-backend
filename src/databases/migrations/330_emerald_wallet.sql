-- =============================================================================
-- Migration 330 — A7: Verde Esmeralda (a moeda que se GANHA)
-- =============================================================================
-- 1 Gold = 1.000 Esmeralda. Esmeralda se ganha (nível, anúncio, prêmio de meta,
-- engajamento, Meu Mundo) ou convertendo Gold (só nessa direção — Esmeralda
-- NUNCA vira Gold). Compra manifestações, destaques e itens do jogo.
--
-- Carteira e ledger PRÓPRIOS, no mesmo padrão da polen_* (mig 034/146):
--   * ledger obrigatório, saldo nunca negativo;
--   * único (source, source_id) entre as linhas 'posted' — dedupe por ação;
--   * único (type, source_id) nos créditos que vêm de evento externo.
--
-- Preço em Esmeralda (`price_emerald` / `emerald_price_*`):
--   NULL = segue a regra padrão (preço em Gold × 1.000);
--   0    = não vende nessa moeda;
--   > 0  = preço definido pelo admin.
--
-- Tetos diários (dia de Brasília) em emerald_settings, editáveis no admin:
--   engagement_daily_cap 500 (curtir/salvar/comentar/compartilhar + alcance),
--   work_daily_cap 150 (trabalho no Meu Mundo — conta atual: 14/h × ~1,6 de
--   inteligência/foco × ~6–8 h úteis ≈ 130–180 por dia).
-- Cupom Gold: 12 Gold a cada R$ 10 de desconto (`coupon_gold_per_10_brl`).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.emerald_settings (
  id                        INTEGER PRIMARY KEY DEFAULT 1,
  is_active                 BOOLEAN NOT NULL DEFAULT TRUE,
  conversion_enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  engagement_enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  engagement_daily_cap      INTEGER NOT NULL DEFAULT 500,
  work_daily_cap            INTEGER NOT NULL DEFAULT 150,
  points_like               INTEGER NOT NULL DEFAULT 1,
  points_save               INTEGER NOT NULL DEFAULT 2,
  points_comment            INTEGER NOT NULL DEFAULT 3,
  points_share              INTEGER NOT NULL DEFAULT 5,
  comment_min_chars         INTEGER NOT NULL DEFAULT 10,
  reach_points_per_emerald  INTEGER NOT NULL DEFAULT 10,
  coupon_gold_per_10_brl    INTEGER NOT NULL DEFAULT 12,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by                UUID REFERENCES public.tb_user(id_user),
  CONSTRAINT emerald_settings_singleton CHECK (id = 1),
  CONSTRAINT emerald_settings_nonnegative CHECK (
    engagement_daily_cap >= 0 AND work_daily_cap >= 0
    AND points_like >= 0 AND points_save >= 0 AND points_comment >= 0 AND points_share >= 0
    AND comment_min_chars >= 0 AND reach_points_per_emerald > 0
    AND coupon_gold_per_10_brl > 0
  )
);

INSERT INTO public.emerald_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.emerald_wallets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL UNIQUE REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  balance           INTEGER NOT NULL DEFAULT 0,
  lifetime_earned   INTEGER NOT NULL DEFAULT 0,
  lifetime_spent    INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT emerald_wallets_nonnegative CHECK (
    balance >= 0 AND lifetime_earned >= 0 AND lifetime_spent >= 0
  )
);

CREATE TABLE IF NOT EXISTS public.emerald_transactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  wallet_id   UUID NOT NULL REFERENCES public.emerald_wallets(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  amount      INTEGER NOT NULL,
  source      TEXT,
  source_id   TEXT,
  status      TEXT NOT NULL DEFAULT 'posted',
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT emerald_transactions_type_chk CHECK (
    type IN (
      'earn_level_up', 'earn_rewarded_ad', 'earn_community_goal',
      'earn_engagement', 'earn_reach',
      'earn_meu_mundo', 'earn_meu_mundo_work', 'earn_coin_migration',
      'earn_gold_conversion',
      'spend_manifestation', 'spend_premium_highlight', 'spend_clan_highlight',
      'spend_premium', 'spend_meu_mundo',
      'admin_adjustment', 'refund', 'reversal'
    )
  ),
  CONSTRAINT emerald_transactions_status_chk CHECK (status IN ('pending','posted','rejected','reversed'))
);

CREATE INDEX IF NOT EXISTS ix_emerald_tx_user_created
  ON public.emerald_transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_emerald_tx_user_type_created
  ON public.emerald_transactions (user_id, type, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ux_emerald_tx_source
  ON public.emerald_transactions (source, source_id)
  WHERE source IS NOT NULL AND source_id IS NOT NULL AND status = 'posted';
CREATE UNIQUE INDEX IF NOT EXISTS ux_emerald_tx_credit_dedupe
  ON public.emerald_transactions (type, source_id)
  WHERE source_id IS NOT NULL
    AND status = 'posted'
    AND type IN ('earn_level_up', 'earn_rewarded_ad', 'earn_community_goal',
                 'earn_gold_conversion', 'earn_coin_migration');

-- Preços em Esmeralda (NULL = Gold × 1.000).
ALTER TABLE public.manifestation_products ADD COLUMN IF NOT EXISTS price_emerald INTEGER;
ALTER TABLE public.premium_settings ADD COLUMN IF NOT EXISTS price_emerald INTEGER;
ALTER TABLE public.premium_city_overrides ADD COLUMN IF NOT EXISTS price_emerald INTEGER;
ALTER TABLE public.polen_settings ADD COLUMN IF NOT EXISTS emerald_price_premium_highlight INTEGER;
ALTER TABLE public.polen_settings ADD COLUMN IF NOT EXISTS emerald_price_clan_highlight INTEGER;

ALTER TABLE public.manifestation_products DROP CONSTRAINT IF EXISTS manifestation_products_price_emerald_chk;
ALTER TABLE public.manifestation_products
  ADD CONSTRAINT manifestation_products_price_emerald_chk CHECK (price_emerald IS NULL OR price_emerald >= 0);
ALTER TABLE public.premium_settings DROP CONSTRAINT IF EXISTS premium_settings_price_emerald_chk;
ALTER TABLE public.premium_settings
  ADD CONSTRAINT premium_settings_price_emerald_chk CHECK (price_emerald IS NULL OR price_emerald >= 0);
ALTER TABLE public.premium_city_overrides DROP CONSTRAINT IF EXISTS premium_city_overrides_price_emerald_chk;
ALTER TABLE public.premium_city_overrides
  ADD CONSTRAINT premium_city_overrides_price_emerald_chk CHECK (price_emerald IS NULL OR price_emerald >= 0);
ALTER TABLE public.polen_settings DROP CONSTRAINT IF EXISTS polen_settings_emerald_prices_chk;
ALTER TABLE public.polen_settings
  ADD CONSTRAINT polen_settings_emerald_prices_chk CHECK (
    (emerald_price_premium_highlight IS NULL OR emerald_price_premium_highlight >= 0)
    AND (emerald_price_clan_highlight IS NULL OR emerald_price_clan_highlight >= 0)
  );

-- Compras pagas em Esmeralda: o payment_method das manifestações e do
-- premium aceita 'emerald' (superset, mesmo nome de constraint).
ALTER TABLE public.user_manifestations DROP CONSTRAINT IF EXISTS user_manifestations_payment_method_check;
ALTER TABLE public.user_manifestations
  ADD CONSTRAINT user_manifestations_payment_method_check
  CHECK (payment_method IN ('stripe', 'polens', 'admin', 'free', 'emerald'));
ALTER TABLE public.user_manifestations ADD COLUMN IF NOT EXISTS amount_emerald INTEGER;

ALTER TABLE public.profile_premium DROP CONSTRAINT IF EXISTS profile_premium_payment_method_check;
ALTER TABLE public.profile_premium
  ADD CONSTRAINT profile_premium_payment_method_check
  CHECK (payment_method IN ('stripe', 'polens', 'emerald'));
ALTER TABLE public.profile_premium ADD COLUMN IF NOT EXISTS amount_emerald INTEGER;
