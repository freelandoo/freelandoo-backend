-- 292 — MEU MUNDO 3D: nível da casa 01–10 (seletor administrativo de teste).
--
-- A mig 291 travou `level = 1`. Esta etapa integra os modelos dos níveis
-- 02–10 e deixa o TITULAR trocar o nível da própria casa para testar a
-- aparência no bairro. Não é loja, compra nem evolução: nada aqui toca saldo,
-- Poléns ou patrimônio, e continua `environment = 'dev'` (mig 291).
--
-- Quem decide se um nível pode ser escolhido é o catálogo do servidor
-- (src/utils/meuMundoHouses.js — o 10 ainda não tem modelo); o CHECK só
-- garante a faixa.
--
-- level_rev: contador monotônico por casa. Cada troca confirmada incrementa
-- na MESMA instrução que grava o nível; a sala multiplayer e os clientes
-- aplicam só revisões maiores que a que já têm — é o que faz a ÚLTIMA escolha
-- confirmada vencer quando dois pedidos se cruzam.

ALTER TABLE public.tb_mm_house DROP CONSTRAINT IF EXISTS chk_mm_house_level;
ALTER TABLE public.tb_mm_house
  ADD CONSTRAINT chk_mm_house_level CHECK (level BETWEEN 1 AND 10);

ALTER TABLE public.tb_mm_house ADD COLUMN IF NOT EXISTS level_rev INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.tb_mm_house ADD COLUMN IF NOT EXISTS level_updated_at TIMESTAMPTZ NULL;
