-- 441 — MEU MUNDO 3D, lore v2 N2: o néctar da semana.
--
-- O néctar sai da POSIÇÃO no placar semanal de cada jogável (mig 440,
-- utils/meuMundoNectar.js). Depois do sábado 23:59 de Brasília o servidor fecha
-- a semana UMA vez (MeuMundoNectarService.closeWeek, com trava):
--   tb_mm_nectar_award   o recibo: conta × semana × jogo (chave única = rodar
--                        duas vezes nunca credita duas vezes)
--   tb_mm_nectar_wallet  a carteira da CONTA: `pending_ml` = néctar para
--                        entregar na estátua (a entrega é a N3); `earned_ml` =
--                        tudo o que já ganhou
--   tb_mm_nectar_week    a semana fechada (quando, quantas contas, quanto)
-- Tudo em mililitros inteiros. Idempotente: só cria.

CREATE TABLE IF NOT EXISTS public.tb_mm_nectar_award (
  id_user UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  week DATE NOT NULL,
  game TEXT NOT NULL,
  position INTEGER NOT NULL,
  value BIGINT NOT NULL,
  ml INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_user, week, game),
  CONSTRAINT chk_mm_nectar_award_game CHECK (game IN ('jetpack', 'noturno', 'corrida', 'gincana', 'paint', 'laminas', 'boxe', 'hall', 'poder')),
  CONSTRAINT chk_mm_nectar_award_ml CHECK (ml > 0),
  CONSTRAINT chk_mm_nectar_award_position CHECK (position >= 1),
  CONSTRAINT chk_mm_nectar_award_week CHECK (EXTRACT(DOW FROM week) = 0)
);
CREATE INDEX IF NOT EXISTS idx_mm_nectar_award_week ON public.tb_mm_nectar_award (week, game, position);

CREATE TABLE IF NOT EXISTS public.tb_mm_nectar_wallet (
  id_user UUID PRIMARY KEY REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  pending_ml BIGINT NOT NULL DEFAULT 0,
  earned_ml BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_mm_nectar_wallet_pending CHECK (pending_ml >= 0),
  CONSTRAINT chk_mm_nectar_wallet_earned CHECK (earned_ml >= 0)
);

CREATE TABLE IF NOT EXISTS public.tb_mm_nectar_week (
  week DATE PRIMARY KEY,
  closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accounts INTEGER NOT NULL DEFAULT 0,
  total_ml BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT chk_mm_nectar_week_dow CHECK (EXTRACT(DOW FROM week) = 0)
);
