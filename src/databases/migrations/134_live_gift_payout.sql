-- =============================================================================
-- Migration 134: repasse de presentes ao criador + 2 presentes de teste
-- =============================================================================
-- Quando um espectador envia um presente, os Poléns gastos são REPASSADOS ao
-- dono da live (id_user da tb_live). O crédito vai pra polen_transactions com
-- type='earn_live_gift'. Idempotente.
--
-- Também adiciona 2 presentes baratos ao catálogo (tb_live_gift) só pra teste,
-- sem duplicar se já existirem (checa por nome).
-- =============================================================================

BEGIN;

-- ── Novo tipo de transação: crédito ao criador ──────────────────────────────
ALTER TABLE public.polen_transactions
  DROP CONSTRAINT IF EXISTS polen_transactions_type_chk;

ALTER TABLE public.polen_transactions
  ADD CONSTRAINT polen_transactions_type_chk CHECK (
    type IN (
      'earn_rewarded_ad',
      'earn_purchase_stripe',
      'earn_level_up',
      'earn_live_gift',
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

-- ── Presentes de teste (baratos) ────────────────────────────────────────────
INSERT INTO public.tb_live_gift (name, emoji, color, animation, price_polens, sort_order)
SELECT 'Aplausos', '👏', '#34D399', 'pulse', 5, 10
WHERE NOT EXISTS (SELECT 1 FROM public.tb_live_gift WHERE name = 'Aplausos');

INSERT INTO public.tb_live_gift (name, emoji, color, animation, price_polens, sort_order)
SELECT 'Estrela', '⭐', '#FACC15', 'spin', 20, 11
WHERE NOT EXISTS (SELECT 1 FROM public.tb_live_gift WHERE name = 'Estrela');

COMMIT;
