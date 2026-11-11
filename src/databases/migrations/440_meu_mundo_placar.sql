-- 440 — MEU MUNDO 3D, lore v2 N1: o placar semanal de cada jogável.
--
-- tb_mm_score: a marca da SEMANA (domingo a sábado, Brasília; `week` = o
-- domingo) de cada CONTA em cada jogável. Quem grava é o servidor, na mesma
-- transação do recibo da partida (utils/meuMundoScores.js diz como cada jogo
-- conta: maior pontuação, menor tempo ou soma de vitórias). O Poder não grava
-- aqui (é o número de agora). `best_at` = quando a marca foi feita (desempate:
-- quem chegou primeiro). A N2 lê este placar para o néctar da semana.
-- Idempotente: só cria.

CREATE TABLE IF NOT EXISTS public.tb_mm_score (
  id_user UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  game TEXT NOT NULL,
  week DATE NOT NULL,
  best INTEGER NOT NULL,
  plays INTEGER NOT NULL DEFAULT 1,
  best_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_user, game, week),
  CONSTRAINT chk_mm_score_game CHECK (game IN ('jetpack', 'noturno', 'corrida', 'gincana', 'paint', 'laminas', 'boxe', 'hall')),
  CONSTRAINT chk_mm_score_best CHECK (best >= 0),
  CONSTRAINT chk_mm_score_week CHECK (EXTRACT(DOW FROM week) = 0)
);

-- o ranking lê por jogo e semana
CREATE INDEX IF NOT EXISTS idx_mm_score_game_week ON public.tb_mm_score (game, week);
