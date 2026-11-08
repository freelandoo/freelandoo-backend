-- 370 — MEU MUNDO 3D B10 (2026-11-08): academia e universidade com progressão.
--
-- A atividade de treino/estudo guarda o APARELHO ou CURSO escolhido dentro do prédio e o
-- nível ("weights:3", "treadmill:2", "bag", "course:4", "book:1"). A regra (níveis
-- travados pelo atributo, rendimento por nível, saco treinando acurácia) mora em
-- src/utils/meuMundoLife.js (STATIONS). NULL = o treino de sempre (força + velocidade).
-- Idempotente.
ALTER TABLE public.tb_mm_character ADD COLUMN IF NOT EXISTS activity_station TEXT NULL;
