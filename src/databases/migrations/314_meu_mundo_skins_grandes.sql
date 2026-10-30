-- 314 — Meu Mundo 3D: mais quatro skins de 2 m (Ciborgue, Cavaleiro Dourado,
-- Golem de Pedra, Dama das Garras), mesma receita dos deuses (mig 313).
-- CHECK do corpo reescrito como SUPERSET, mesmo nome de constraint.

ALTER TABLE public.tb_mm_avatar_pref DROP CONSTRAINT IF EXISTS chk_mm_avatar_body;
ALTER TABLE public.tb_mm_avatar_pref
  ADD CONSTRAINT chk_mm_avatar_body CHECK (body IN (
    'normal', 'slim', 'fat', 'strong', 'sergio', 'female', 'ekaterina',
    'aurion', 'morkhan', 'kragor', 'zephyra', 'maru', 'iris', 'noctis', 'aeryn',
    'ciborgue', 'cavaleiro', 'golem', 'garras'
  ));
