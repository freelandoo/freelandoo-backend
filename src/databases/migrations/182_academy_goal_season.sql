-- =============================================================================
-- Migration 182: Temporada de metas da academia (janela de 30/60/90 dias)
-- Igual às comunidades: o dono "inicia uma temporada" e as metas do ranking
-- passam a valer por uma janela fixa (a partir de season_started_at) em vez do
-- mês-calendário. Sem temporada ativa, o ranking cai no mês corrente. Idempotente.
-- =============================================================================

ALTER TABLE public.tb_academy_goal
  ADD COLUMN IF NOT EXISTS season_started_at TIMESTAMPTZ NULL;

ALTER TABLE public.tb_academy_goal
  ADD COLUMN IF NOT EXISTS season_days INT NOT NULL DEFAULT 30
    CHECK (season_days IN (30, 60, 90));
