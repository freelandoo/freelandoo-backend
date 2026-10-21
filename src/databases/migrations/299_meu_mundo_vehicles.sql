-- 299 — MEU MUNDO 3D: onde ficam os veículos (mm3d-15).
--
-- Pedido do Alex: onde a pessoa deixa o carro, a bicicleta, o skate ou os
-- patins, eles continuam lá quando ela volta ao jogo. Até o mm3d-14 a posição
-- vivia só na sala (reabrir punha tudo de volta na vaga da casa).
--
-- Uma linha por veículo que JÁ SAIU da vaga. Sem linha = na vaga da casa
-- (src/utils/meuMundoCars.js, spotFor). Id do veículo = lote + deslocamento
-- da modalidade (carro 1–20, bike 21–40, skate 41–60, patins 61–80).
--
--   id_house NULL  -> na rua do bairro, em (x, z, facing) do mundo;
--   id_house       -> guardado DENTRO dessa casa (bike, skate e patins
--                     entram em casa; o carro, não), em (x, z, facing) do
--                     interior, no andar `floor`.
--
-- `layout` = LAYOUT_VERSION do bairro em que a posição foi gravada: posição
-- de outro desenho do bairro volta para a vaga (como a última posição de
-- quem anda a pé).
--
-- ISOLAMENTO: como as outras tb_mm_*, nada aqui toca saldo, Poléns ou
-- patrimônio da Freelandoo.

CREATE TABLE IF NOT EXISTS public.tb_mm_vehicle (
  id_neighborhood UUID NOT NULL REFERENCES public.tb_mm_neighborhood(id_neighborhood) ON DELETE CASCADE,
  vehicle_id SMALLINT NOT NULL,
  x REAL NOT NULL,
  z REAL NOT NULL,
  facing REAL NOT NULL,
  id_house UUID NULL REFERENCES public.tb_mm_house(id_house) ON DELETE CASCADE, -- casa apagada: volta à vaga
  floor SMALLINT NOT NULL DEFAULT 0,
  layout SMALLINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_neighborhood, vehicle_id),
  CONSTRAINT chk_mm_vehicle_id CHECK (vehicle_id BETWEEN 1 AND 80),
  -- O carro nunca entra em casa.
  CONSTRAINT chk_mm_vehicle_car_outside CHECK (vehicle_id > 20 OR id_house IS NULL)
);

CREATE INDEX IF NOT EXISTS ix_mm_vehicle_house ON public.tb_mm_vehicle (id_house) WHERE id_house IS NOT NULL;
