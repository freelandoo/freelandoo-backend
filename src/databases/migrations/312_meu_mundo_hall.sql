-- 312 — Meu Mundo 3D mm3d-48: Salão do Hall da Fama.
--
-- Quem pode entrar no Salão: quem ficou 3 meses seguidos em 1º no ranking de
-- uma prova (a virada do mês grava aqui quando o ranking existir — mm3d-48d).
-- `game` = a prova (boxe, gincana, paint, corrida, noturno, jetpack, laminas
-- ou "geral"); `since` = o mês em que completou os 3 meses. Uma linha por
-- pessoa e prova; nunca é apagada (o título é para sempre).

CREATE TABLE IF NOT EXISTS public.tb_mm_hall_member (
  id_user UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  game TEXT NOT NULL,
  since DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id_user, game)
);

CREATE INDEX IF NOT EXISTS ix_mm_hall_member_since ON public.tb_mm_hall_member (since DESC);
