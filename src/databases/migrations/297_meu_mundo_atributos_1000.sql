-- 297 — MEU MUNDO 3D (mm3d-13): atributos treináveis na escala 0–1000.
--
-- Inteligência, força e velocidade passam de 0–100 para 0–1000 (progressão
-- longa: com o ritmo máximo, 800 leva ~1 ano). Fertilidade continua 0–100.
-- `attr_peaks` guarda o maior valor já alcançado de cada um: o piso que não
-- se perde mais (força/velocidade 60%, inteligência 90%) sai dele. Regra em
-- src/utils/meuMundoLife.js (ATTR).
--
-- Idempotente: a conversão ×10 só pega linha sem `attr_peaks` e preenche
-- `attr_peaks` no mesmo UPDATE — rodar de novo não multiplica outra vez.

ALTER TABLE public.tb_mm_character ADD COLUMN IF NOT EXISTS attr_peaks JSONB NULL;

UPDATE public.tb_mm_character
   SET intelligence = intelligence * 10,
       strength = strength * 10,
       speed = speed * 10,
       attr_peaks = jsonb_build_object(
         'intelligence', intelligence * 10,
         'strength', strength * 10,
         'speed', speed * 10
       )
 WHERE attr_peaks IS NULL;
