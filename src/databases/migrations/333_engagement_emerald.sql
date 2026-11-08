-- =============================================================================
-- Migration 333 — A7: Esmeralda por engajamento
-- =============================================================================
-- Quem engaja ganha (curtir 1, salvar 2, comentar 3 com ≥ 10 caracteres,
-- compartilhar 5 — emerald_settings) e o DONO do post ganha 1 Esmeralda a
-- cada 10 pontos de alcance (utils/feedReach.js, A1) que OUTRAS contas
-- logadas deram. Teto diário somado (engagement_daily_cap, 500).
--
-- Por post/bee:
--   reach_emerald_acc  = pontos de alcance elegíveis acumulados (só sobem:
--                        desfazer não devolve ao dono, e refazer não paga de novo);
--   reach_emerald_paid = Esmeraldas já pagas ao dono por este post.
-- O dono recebe floor(acc / 10) − paid, até o teto do dia; o que passar do
-- teto fica para o próximo evento (paid só sobe pelo que foi pago).
-- =============================================================================

ALTER TABLE public.tb_profile_portfolio_item
  ADD COLUMN IF NOT EXISTS reach_emerald_acc NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.tb_profile_portfolio_item
  ADD COLUMN IF NOT EXISTS reach_emerald_paid INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.tb_story
  ADD COLUMN IF NOT EXISTS reach_emerald_acc NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.tb_story
  ADD COLUMN IF NOT EXISTS reach_emerald_paid INTEGER NOT NULL DEFAULT 0;
