-- 317 — Meu Mundo 3D mm3d-58: o hóspede CRESCE.
--
-- Nasce jovem (o modelo "inicial" da classe) e vira adulto pela idade; treino
-- na academia adianta e o anabolizante dobra o adiantamento. Ao virar adulto
-- ganha 20% em cada atributo e a saúde volta a 100 (regra única em
-- src/utils/meuMundoLife.js, GROWTH). Guarda { stage, days }; NULL = hóspede
-- de antes — a regra começa a contar pelos dias de vida já gastos.

ALTER TABLE tb_mm_character ADD COLUMN IF NOT EXISTS growth JSONB;
