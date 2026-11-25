-- 472 (25/11/2026): não existe skin no Meu Mundo — cada personagem é um ser com certidão,
-- vida e personalidade próprias. O aviso "STATUS → SKIN → Cores" (colors_hint, mm3d-36)
-- apontava para uma tela que não existe mais; sai do sino de todo mundo. Idempotente.
DELETE FROM tb_mm_notice WHERE code = 'colors_hint';
