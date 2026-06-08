-- =============================================================================
-- Migration 133: adiciona 'spend_live_gift' ao enum de polen_transactions.type
-- =============================================================================
-- Presentes enviados nas Lives gastam Poléns (tb_live_gift_event, mig 132).
-- O débito vai pra polen_transactions com type='spend_live_gift'. Idempotente.
-- =============================================================================

BEGIN;

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
      'spend_live_gift',
      'admin_adjustment',
      'refund',
      'reversal'
    )
  );

COMMIT;
