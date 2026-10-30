-- 313 — Meu Mundo 3D mm3d-50: os deuses de Lúmen como skins.
--
-- Os Sete e Morkhan viram corpos (skin e corpo com o mesmo id, ver
-- src/utils/meuMundoSkins.js). CHECK do corpo reescrito como SUPERSET, mesmo
-- nome de constraint. Os ids de skin já passam pelo chk_mm_avatar_skin (mig 300).

ALTER TABLE public.tb_mm_avatar_pref DROP CONSTRAINT IF EXISTS chk_mm_avatar_body;
ALTER TABLE public.tb_mm_avatar_pref
  ADD CONSTRAINT chk_mm_avatar_body CHECK (body IN (
    'normal', 'slim', 'fat', 'strong', 'sergio', 'female', 'ekaterina',
    'aurion', 'morkhan', 'kragor', 'zephyra', 'maru', 'iris', 'noctis', 'aeryn'
  ));
