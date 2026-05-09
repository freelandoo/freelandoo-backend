-- Migration 034: Polens internal credit system
-- Non-transferable, non-withdrawable internal credits with mandatory ledger.

CREATE TABLE IF NOT EXISTS public.polen_settings (
  id                                      INTEGER PRIMARY KEY DEFAULT 1,
  is_active                               BOOLEAN NOT NULL DEFAULT TRUE,
  polens_per_ad                           INTEGER NOT NULL DEFAULT 25,
  ads_per_day_per_user                    INTEGER NOT NULL DEFAULT 10,
  cooldown_seconds                        INTEGER NOT NULL DEFAULT 240,
  daily_polens_limit                      INTEGER NOT NULL DEFAULT 250,
  price_profile_activation                INTEGER NOT NULL DEFAULT 1200,
  price_premium_highlight                 INTEGER NOT NULL DEFAULT 800,
  price_post_boost                        INTEGER NOT NULL DEFAULT 500,
  price_profile_boost                     INTEGER NOT NULL DEFAULT 700,
  price_clan_highlight                    INTEGER NOT NULL DEFAULT 900,
  rewarded_provider                       TEXT NOT NULL DEFAULT 'mock',
  rewarded_ad_unit_id                     TEXT,
  created_at                              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by                              UUID REFERENCES public.tb_user(id_user),
  CONSTRAINT polen_settings_singleton CHECK (id = 1),
  CONSTRAINT polen_settings_nonnegative CHECK (
    polens_per_ad >= 0 AND ads_per_day_per_user >= 0 AND cooldown_seconds >= 0
    AND daily_polens_limit >= 0 AND price_profile_activation >= 0
    AND price_premium_highlight >= 0 AND price_post_boost >= 0
    AND price_profile_boost >= 0 AND price_clan_highlight >= 0
  )
);

INSERT INTO public.polen_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.polen_wallets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL UNIQUE REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  balance           INTEGER NOT NULL DEFAULT 0,
  lifetime_earned   INTEGER NOT NULL DEFAULT 0,
  lifetime_spent    INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT polen_wallets_nonnegative CHECK (
    balance >= 0 AND lifetime_earned >= 0 AND lifetime_spent >= 0
  )
);

CREATE TABLE IF NOT EXISTS public.polen_transactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  wallet_id   UUID NOT NULL REFERENCES public.polen_wallets(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  amount      INTEGER NOT NULL,
  source      TEXT,
  source_id   TEXT,
  status      TEXT NOT NULL DEFAULT 'posted',
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT polen_transactions_type_chk CHECK (
    type IN (
      'earn_rewarded_ad',
      'spend_profile_activation',
      'spend_premium_highlight',
      'spend_profile_boost',
      'spend_post_boost',
      'spend_clan_highlight',
      'admin_adjustment',
      'refund',
      'reversal'
    )
  ),
  CONSTRAINT polen_transactions_status_chk CHECK (status IN ('pending','posted','rejected','reversed'))
);

CREATE INDEX IF NOT EXISTS ix_polen_transactions_user_created
  ON public.polen_transactions (user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ux_polen_transactions_source
  ON public.polen_transactions (source, source_id)
  WHERE source IS NOT NULL AND source_id IS NOT NULL AND status = 'posted';

CREATE TABLE IF NOT EXISTS public.rewarded_ad_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  provider         TEXT NOT NULL,
  ad_unit_id       TEXT,
  reward_token     TEXT NOT NULL UNIQUE,
  reward_amount    INTEGER NOT NULL,
  status           TEXT NOT NULL DEFAULT 'requested',
  watched_at       TIMESTAMPTZ,
  credited_at      TIMESTAMPTZ,
  ip_hash          TEXT,
  user_agent_hash  TEXT,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT rewarded_ad_events_status_chk CHECK (
    status IN ('requested','watched','rewarded','rejected','expired')
  ),
  CONSTRAINT rewarded_ad_events_amount_chk CHECK (reward_amount >= 0)
);

CREATE INDEX IF NOT EXISTS ix_rewarded_ad_events_user_created
  ON public.rewarded_ad_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_rewarded_ad_events_status
  ON public.rewarded_ad_events (status);
