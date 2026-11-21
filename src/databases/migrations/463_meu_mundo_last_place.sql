-- 463 — MEU MUNDO 3D: voltar onde parou (21/11, pedido do Alex: "quando eu saio do jogo ele sempre volta
-- pra casa e não onde ele estava").
--
-- O último lugar de cada pessoa (rua de qual bairro, dentro de qual casa ou o centro) com a posição, gravado
-- pelas salas a cada ~10 s e ao sair (realtime/meuMundoLastPlace.js). Antes isso morava só na memória do
-- processo (10 min, zerava a cada deploy). Uma linha por pessoa; `layout` = versão do desenho do lugar (bairro:
-- LAYOUT_VERSION; centro: CENTER_VERSION; casa: nível) — posição de outro desenho não vale.
-- Idempotente: só cria.

CREATE TABLE IF NOT EXISTS public.tb_mm_last_place (
  id_user UUID PRIMARY KEY REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  scene TEXT NOT NULL,
  id_neighborhood UUID NULL,
  id_house UUID NULL,
  x REAL NOT NULL,
  z REAL NOT NULL,
  facing REAL NOT NULL DEFAULT 0,
  floor SMALLINT NOT NULL DEFAULT 0,
  layout INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_mm_last_place_scene CHECK (scene IN ('nb', 'house', 'center'))
);
