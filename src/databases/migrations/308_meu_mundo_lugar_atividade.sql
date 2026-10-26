-- 308 — Meu Mundo 3D mm3d-37: o centro por dentro.
--
-- Treino e estudo só dentro do prédio do centro (academia; universidade,
-- biblioteca ou escola): a atividade guarda o LUGAR (a universidade rende mais
-- e cobra a hora de aula). E as atividades novas: rezar na igreja (praying) e
-- preso na delegacia (jail). CHECK reescrito como superconjunto, mesmo nome.

ALTER TABLE tb_mm_character ADD COLUMN IF NOT EXISTS activity_place TEXT;

ALTER TABLE tb_mm_character DROP CONSTRAINT IF EXISTS chk_mm_character_activity;
ALTER TABLE tb_mm_character ADD CONSTRAINT chk_mm_character_activity CHECK (
  activity IN ('idle', 'lying', 'sleeping', 'studying', 'training', 'working', 'hospital', 'praying', 'jail')
);
