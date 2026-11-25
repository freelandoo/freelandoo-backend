-- legend-v1 (24/11/2026): o prêmio Lendário do 1º lugar da semana de cada minijogo (Jetpack, Rolê Noturno,
-- Antigravidade, Gincana, Paint). Gravado no fechamento da semana (MeuMundoNectarService.closeWeek), na mesma
-- transação do néctar: um por semana × jogo (rodar de novo nunca entrega de novo).
CREATE TABLE IF NOT EXISTS public.tb_mm_week_prize (
  week        DATE        NOT NULL,
  game        VARCHAR(16) NOT NULL,
  id_user     UUID        NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  value       NUMERIC     NOT NULL,
  items       JSONB       NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (week, game)
);
CREATE INDEX IF NOT EXISTS ix_mm_week_prize_user ON public.tb_mm_week_prize (id_user, week DESC);
