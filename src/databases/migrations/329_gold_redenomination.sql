-- =============================================================================
-- Migration 329 — A7: o Pólen vira GOLD (1 Gold = R$ 1)
-- =============================================================================
-- Até aqui 1 Pólen = R$ 0,01. Decisão do Alex (cronograma A7, 08/11/2026): a
-- moeda comprada passa a se chamar Gold e vale R$ 1, ou seja, tudo ÷ 100.
-- O nome das tabelas fica (polen_*: legado não se renomeia, só o texto).
--
-- 1) LEDGER AUDITÁVEL: `polen_transactions.unit` diz em que unidade está o
--    `amount` da linha. Tudo que existia vira 'polen' (centésimo do Gold);
--    tudo que nasce depois é 'gold'. Cada carteira ganha UMA linha
--    `redenomination` (source='redenomination', source_id=id da carteira, o
--    índice único de (source, source_id) garante uma só) com amount = saldo
--    NOVO em Gold e, no metadata, o saldo antigo e a regra. A partir dela a
--    soma das linhas 'gold' da carteira é o saldo.
-- 2) SALDO: CEIL(saldo/100) — quem tinha 150 Pólens fica com 2 Gold; o
--    usuário nunca perde. lifetime_earned também arredonda para cima e
--    lifetime_spent para baixo (o histórico nunca piora para o usuário).
-- 3) PREÇOS EM PÓLENS: CEIL(preço/100), 0 continua 0 (= não vende). Vale para
--    as configurações, pacotes, manifestações, premium, presentes de live,
--    Loja de Funções, vaga de anúncio do condomínio e custos da prospecção.
--    As fontes GRÁTIS (anúncio, nível, prêmio da meta) NÃO mudam de número:
--    passam a pagar Esmeralda (mig 330).
-- 4) COMPRAS DE PACOTE: `polen_purchases.gold_credited` guarda o crédito em
--    Gold (o estorno lê esta coluna; `polens_credited` fica como histórico).
--
-- Roda UMA vez: a trava é `polen_settings.gold_redenominated_at` dentro do
-- mesmo bloco. Re-executar não divide de novo.
-- =============================================================================

ALTER TABLE public.polen_transactions
  ADD COLUMN IF NOT EXISTS unit TEXT;
UPDATE public.polen_transactions SET unit = 'polen' WHERE unit IS NULL;
ALTER TABLE public.polen_transactions ALTER COLUMN unit SET DEFAULT 'gold';
ALTER TABLE public.polen_transactions ALTER COLUMN unit SET NOT NULL;
ALTER TABLE public.polen_transactions DROP CONSTRAINT IF EXISTS polen_transactions_unit_chk;
ALTER TABLE public.polen_transactions
  ADD CONSTRAINT polen_transactions_unit_chk CHECK (unit IN ('polen', 'gold'));

ALTER TABLE public.polen_settings
  ADD COLUMN IF NOT EXISTS gold_redenominated_at TIMESTAMPTZ;

ALTER TABLE public.polen_purchases
  ADD COLUMN IF NOT EXISTS gold_credited INTEGER;

-- Superset do CHECK da mig 302 + os tipos do A7.
ALTER TABLE public.polen_transactions
  DROP CONSTRAINT IF EXISTS polen_transactions_type_chk;
ALTER TABLE public.polen_transactions
  ADD CONSTRAINT polen_transactions_type_chk CHECK (
    type IN (
      'earn_rewarded_ad', 'earn_purchase_stripe', 'earn_level_up', 'earn_live_gift',
      'earn_community_goal',
      'spend_profile_activation', 'spend_premium_highlight', 'spend_profile_boost',
      'spend_post_boost', 'spend_clan_highlight', 'spend_manifestation', 'spend_premium',
      'spend_live_gift', 'spend_function_purchase', 'spend_condo_listing_slot',
      'spend_meu_mundo',
      'spend_gold_coupon', 'spend_emerald_conversion', 'redenomination',
      'admin_adjustment', 'refund', 'reversal'
    )
  ) NOT VALID;

DO $$
DECLARE
  done TIMESTAMPTZ;
BEGIN
  SELECT gold_redenominated_at INTO done FROM public.polen_settings WHERE id = 1;
  IF done IS NOT NULL THEN
    RETURN;
  END IF;

  -- Linha de abertura por carteira, com o saldo antigo no metadata.
  INSERT INTO public.polen_transactions
    (user_id, wallet_id, type, amount, source, source_id, status, metadata, unit)
  SELECT w.user_id, w.id, 'redenomination', CEIL(w.balance / 100.0)::int,
         'redenomination', w.id::text, 'posted',
         jsonb_build_object(
           'rule', 'gold_1_brl', 'divisor', 100, 'rounding', 'up',
           'old_balance', w.balance,
           'old_lifetime_earned', w.lifetime_earned,
           'old_lifetime_spent', w.lifetime_spent
         ),
         'gold'
    FROM public.polen_wallets w
  ON CONFLICT DO NOTHING;

  UPDATE public.polen_wallets
     SET balance = CEIL(balance / 100.0)::int,
         lifetime_earned = CEIL(lifetime_earned / 100.0)::int,
         lifetime_spent = FLOOR(lifetime_spent / 100.0)::int,
         updated_at = NOW();

  UPDATE public.polen_settings
     SET price_profile_activation = CEIL(price_profile_activation / 100.0)::int,
         price_premium_highlight  = CEIL(price_premium_highlight / 100.0)::int,
         price_post_boost         = CEIL(price_post_boost / 100.0)::int,
         price_profile_boost      = CEIL(price_profile_boost / 100.0)::int,
         price_clan_highlight     = CEIL(price_clan_highlight / 100.0)::int,
         gold_redenominated_at    = NOW(),
         updated_at               = NOW()
   WHERE id = 1;

  UPDATE public.polen_products
     SET polens_amount = CEIL(polens_amount / 100.0)::int,
         bonus_polens  = CEIL(bonus_polens / 100.0)::int,
         updated_at    = NOW();

  UPDATE public.polen_purchases
     SET gold_credited = CEIL(polens_credited / 100.0)::int
   WHERE gold_credited IS NULL;

  UPDATE public.manifestation_products
     SET price_polens = CEIL(price_polens / 100.0)::int;

  UPDATE public.premium_settings
     SET price_polens = CEIL(price_polens / 100.0)::int;
  UPDATE public.premium_city_overrides
     SET price_polens = CEIL(price_polens / 100.0)::int
   WHERE price_polens IS NOT NULL;

  UPDATE public.tb_live_gift
     SET price_polens = CEIL(price_polens / 100.0)::int;

  UPDATE public.tb_function_product
     SET price_polens = CEIL(price_polens / 100.0)::int
   WHERE price_polens IS NOT NULL;

  UPDATE public.condo_settings
     SET extra_slot_price_polens = CEIL(extra_slot_price_polens / 100.0)::int,
         listing_monthly_polens  = CEIL(listing_monthly_polens / 100.0)::int;
  UPDATE public.tb_condo_config
     SET extra_slot_price_polens = CEIL(extra_slot_price_polens / 100.0)::int
   WHERE extra_slot_price_polens IS NOT NULL;
  UPDATE public.tb_condo_config
     SET listing_monthly_polens = CEIL(listing_monthly_polens / 100.0)::int
   WHERE listing_monthly_polens IS NOT NULL;

  UPDATE public.prospeccao_settings
     SET enrich_cost_polens = CEIL(enrich_cost_polens / 100.0)::int,
         export_cost_polens = CEIL(export_cost_polens / 100.0)::int;
END $$;

-- Padrões das colunas em Gold (linhas novas criadas sem preço explícito).
ALTER TABLE public.polen_settings ALTER COLUMN price_profile_activation SET DEFAULT 12;
ALTER TABLE public.polen_settings ALTER COLUMN price_premium_highlight SET DEFAULT 8;
ALTER TABLE public.polen_settings ALTER COLUMN price_post_boost SET DEFAULT 5;
ALTER TABLE public.polen_settings ALTER COLUMN price_profile_boost SET DEFAULT 7;
ALTER TABLE public.polen_settings ALTER COLUMN price_clan_highlight SET DEFAULT 9;
ALTER TABLE public.premium_settings ALTER COLUMN price_polens SET DEFAULT 5;
ALTER TABLE public.tb_live_gift ALTER COLUMN price_polens SET DEFAULT 1;
ALTER TABLE public.condo_settings ALTER COLUMN extra_slot_price_polens SET DEFAULT 2;
ALTER TABLE public.condo_settings ALTER COLUMN listing_monthly_polens SET DEFAULT 4;
