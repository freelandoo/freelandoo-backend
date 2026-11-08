-- =============================================================================
-- Migration 332 — A7: as moedas do Meu Mundo viram Verde Esmeralda
-- =============================================================================
-- Decisão do Alex: a Esmeralda SUBSTITUI as moedas do jogo, 1:1, na MESMA
-- carteira da Freelandoo (emerald_wallets, mig 330) — o jogo não tem carteira
-- à parte. Os preços do jogo continuam com o mesmo número.
--
-- tb_mm_wallet fica, mas muda de papel: `coins` passa a guardar só a FRAÇÃO
-- (< 1) que o trabalho rende por hora (a regra da vida é contínua; o ledger da
-- Esmeralda é inteiro). Cada carteira migrada vira uma linha
-- `earn_coin_migration` (source 'mm_coins', source_id = id da pessoa — o
-- índice único garante uma só) com FLOOR(coins); a sobra fracionária fica.
-- `emerald_migrated_at` marca quem já passou; a linha nova (jogador novo) já
-- nasce migrada e ganha as 500 de início pela própria vida.
-- =============================================================================

ALTER TABLE public.tb_mm_wallet ADD COLUMN IF NOT EXISTS emerald_migrated_at TIMESTAMPTZ;

INSERT INTO public.emerald_wallets (user_id)
SELECT w.id_user FROM public.tb_mm_wallet w
 WHERE w.emerald_migrated_at IS NULL AND FLOOR(w.coins) > 0
ON CONFLICT (user_id) DO NOTHING;

WITH m AS (
  SELECT w.id_user, FLOOR(w.coins)::int AS n, w.coins AS old
    FROM public.tb_mm_wallet w
   WHERE w.emerald_migrated_at IS NULL AND FLOOR(w.coins) > 0
),
ins AS (
  INSERT INTO public.emerald_transactions
    (user_id, wallet_id, type, amount, source, source_id, status, metadata)
  SELECT m.id_user, e.id, 'earn_coin_migration', m.n, 'mm_coins', m.id_user::text, 'posted',
         jsonb_build_object('rule', 'mm_coins_1_1', 'old_coins', m.old)
    FROM m JOIN public.emerald_wallets e ON e.user_id = m.id_user
  ON CONFLICT DO NOTHING
  RETURNING user_id, amount
)
UPDATE public.emerald_wallets e
   SET balance = e.balance + ins.amount,
       lifetime_earned = e.lifetime_earned + ins.amount,
       updated_at = NOW()
  FROM ins
 WHERE e.user_id = ins.user_id;

UPDATE public.tb_mm_wallet
   SET coins = coins - FLOOR(coins),
       emerald_migrated_at = NOW(),
       updated_at = NOW()
 WHERE emerald_migrated_at IS NULL;
