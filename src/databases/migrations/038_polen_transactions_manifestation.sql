-- =============================================================================
-- Migration 038: Adiciona 'spend_manifestation' ao enum de polen_transactions.type
-- =============================================================================

ALTER TABLE public.polen_transactions
  DROP CONSTRAINT IF EXISTS polen_transactions_type_chk;

ALTER TABLE public.polen_transactions
  ADD CONSTRAINT polen_transactions_type_chk CHECK (
    type IN (
      'earn_rewarded_ad',
      'spend_profile_activation',
      'spend_premium_highlight',
      'spend_profile_boost',
      'spend_post_boost',
      'spend_clan_highlight',
      'spend_manifestation',
      'admin_adjustment',
      'refund',
      'reversal'
    )
  );
