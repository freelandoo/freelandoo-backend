-- Migration 120: Poléns por subida de nível (XP)
-- Cada vez que um subperfil não-clã sobe de nível, o usuário dono é creditado
-- com `polens_per_level` Poléns. Valor ajustável pelo admin em /admin/ranking → Pesos.

-- 1) Coluna configurável de Poléns por nível (default 1000)
ALTER TABLE public.xp_settings
  ADD COLUMN IF NOT EXISTS polens_per_level INTEGER NOT NULL DEFAULT 1000;

-- 2) Novo tipo de transação de Polén para o crédito de level-up
ALTER TABLE public.polen_transactions
  DROP CONSTRAINT IF EXISTS polen_transactions_type_chk;

ALTER TABLE public.polen_transactions
  ADD CONSTRAINT polen_transactions_type_chk CHECK (
    type IN (
      'earn_rewarded_ad',
      'earn_purchase_stripe',
      'earn_level_up',
      'spend_profile_activation',
      'spend_premium_highlight',
      'spend_profile_boost',
      'spend_post_boost',
      'spend_clan_highlight',
      'spend_manifestation',
      'spend_premium',
      'admin_adjustment',
      'refund',
      'reversal'
    )
  );
