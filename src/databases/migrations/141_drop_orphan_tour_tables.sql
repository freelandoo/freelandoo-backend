-- 141 — F4.S2 (faxina): dropa as tabelas órfãs do monetization onboarding
-- REVERTIDO em 2026-05-23 (migs 103/104 criaram 4 tabelas; os arquivos das
-- migrations foram removidos no revert, mas as tabelas ficaram no banco).
--
-- ATENÇÃO — NÃO dropar as outras duas: `tour_monetization_paths` e
-- `user_onboarding_monetization_state` foram REAPROVEITADAS pela mig 105
-- (Monetization Intent — o IntentModal atual usa as duas via
-- MonetizationIntentStorage).
--
-- Órfãs confirmadas (zero referência no código fora das migs deletadas):
--   - user_tour_path_progress (dropa primeiro: FK pra steps/paths)
--   - tour_path_steps

DROP TABLE IF EXISTS public.user_tour_path_progress;
DROP TABLE IF EXISTS public.tour_path_steps;
