-- 309 — Meu Mundo 3D mm3d-37e: o vendedor do centro (casas e cores do carro).
--
-- A cor do carro é da CASA (o carro mora no lote; NULL = vermelho de fábrica)
-- e as cores compradas são da PESSOA (compra uma vez, troca à vontade). Os
-- ids e preços moram em src/utils/meuMundoShop.js; o CHECK só segura o
-- formato. Preço sai de tb_mm_wallet (moedas do jogo) — nada aqui toca saldo,
-- Poléns ou patrimônio da Freelandoo.

ALTER TABLE public.tb_mm_house ADD COLUMN IF NOT EXISTS car_paint TEXT;
ALTER TABLE public.tb_mm_house DROP CONSTRAINT IF EXISTS chk_mm_house_car_paint;
ALTER TABLE public.tb_mm_house
  ADD CONSTRAINT chk_mm_house_car_paint CHECK (car_paint IS NULL OR car_paint ~ '^[a-z0-9-]{1,32}$');

CREATE TABLE IF NOT EXISTS public.tb_mm_car_paint_owned (
  id_user UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  paint TEXT NOT NULL,
  price INTEGER NOT NULL DEFAULT 0, -- quanto custou (o catálogo pode mudar depois)
  bought_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_user, paint),
  CONSTRAINT chk_mm_car_paint_owned_id CHECK (paint ~ '^[a-z0-9-]{1,32}$')
);
