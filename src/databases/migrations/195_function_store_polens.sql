-- =============================================================================
-- Migration 195: Loja de Funções — pagamento alternativo em Poléns
-- =============================================================================
-- Além do dinheiro (Stripe, mig 191), quatro funções passam a ter um preço em
-- Poléns: Academia, Carteira, Comunidade e Vaquinha (1000 Poléns cada — valor
-- de partida; o admin edita em /administracao/loja-funcoes).
--
-- price_polens é NULLABLE de propósito:
--   NULL  = nunca configurado (estado só antes do seed abaixo)
--   0     = função NÃO é vendida por Poléns (desligado pelo admin)
--   > 0   = preço em Poléns
-- O seed roda só onde a coluna está NULL, e o admin sempre grava um número
-- (desligar = 0, nunca NULL — ver FunctionStoreService.adminUpdateProduct), então
-- esta migration re-executada no boot NUNCA sobrescreve a decisão do admin.
--
-- A compra por Poléns cria a MESMA linha de tb_user_function_purchase usada
-- pelo Stripe (status 'paid', payment_provider 'polens', amount_cents 0,
-- amount_polens = preço pago) — posse continua sendo "compra paga sem refund".
-- Idempotente.
-- =============================================================================

BEGIN;

ALTER TABLE public.tb_function_product
  ADD COLUMN IF NOT EXISTS price_polens INTEGER;

ALTER TABLE public.tb_function_product
  DROP CONSTRAINT IF EXISTS tb_function_product_price_polens_chk;

ALTER TABLE public.tb_function_product
  ADD CONSTRAINT tb_function_product_price_polens_chk
  CHECK (price_polens IS NULL OR price_polens >= 0);

ALTER TABLE public.tb_user_function_purchase
  ADD COLUMN IF NOT EXISTS amount_polens INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.tb_user_function_purchase
  DROP CONSTRAINT IF EXISTS tb_user_function_purchase_amount_polens_chk;

ALTER TABLE public.tb_user_function_purchase
  ADD CONSTRAINT tb_user_function_purchase_amount_polens_chk
  CHECK (amount_polens >= 0);

-- Novo tipo de débito na carteira de Poléns (lista completa re-declarada:
-- o CHECK é substituído por inteiro, como nas migs 133/134/161).
ALTER TABLE public.polen_transactions
  DROP CONSTRAINT IF EXISTS polen_transactions_type_chk;

ALTER TABLE public.polen_transactions
  ADD CONSTRAINT polen_transactions_type_chk CHECK (
    type IN (
      'earn_rewarded_ad', 'earn_purchase_stripe', 'earn_level_up', 'earn_live_gift',
      'earn_community_goal',
      'spend_profile_activation', 'spend_premium_highlight', 'spend_profile_boost',
      'spend_post_boost', 'spend_clan_highlight', 'spend_manifestation', 'spend_premium',
      'spend_live_gift', 'spend_function_purchase',
      'admin_adjustment', 'refund', 'reversal'
    )
  );

-- Preço de partida em Poléns das 4 funções escolhidas pelo Alex.
-- WHERE price_polens IS NULL: só semeia o que nunca foi configurado.
UPDATE public.tb_function_product
   SET price_polens = 1000,
       updated_at   = NOW()
 WHERE feature_key IN ('fitness_academias', 'wallet', 'communities', 'vaquinha')
   AND price_polens IS NULL;

COMMIT;
