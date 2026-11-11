-- 443 — Meu Mundo, apresentação 05 (D9, 2026-11-11): diabetes e pressão alta saem da regra
-- da vida, junto com Metformina e Losartana (fantasia steampunk não tem remédio de bula).
-- 1) quem tinha a doença (ou o risco) fica curado;
-- 2) quem tinha os remédios na despensa recebe as moedas de volta (preço de catálogo:
--    metformina 20, losartana 18) e o item sai da despensa.
-- Idempotente: depois da 1ª vez não sobra linha para curar nem remédio para devolver.

UPDATE public.tb_mm_character
   SET has_diabetes = FALSE, has_hypertension = FALSE, diabetes_risk = 0, bp_risk = 0
 WHERE has_diabetes OR has_hypertension OR diabetes_risk <> 0 OR bp_risk <> 0;

WITH gone AS (
  DELETE FROM public.tb_mm_pantry
   WHERE item_id IN ('metformina', 'losartana')
  RETURNING id_user, qty * CASE item_id WHEN 'metformina' THEN 20 ELSE 18 END AS refund
), tot AS (
  SELECT id_user, SUM(refund) AS refund FROM gone GROUP BY id_user HAVING SUM(refund) > 0
)
INSERT INTO public.tb_mm_wallet (id_user, coins)
SELECT id_user, refund FROM tot
ON CONFLICT (id_user) DO UPDATE SET coins = public.tb_mm_wallet.coins + EXCLUDED.coins, updated_at = NOW();
