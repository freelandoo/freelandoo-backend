-- 298 — MEU MUNDO 3D (mm3d-13): o hóspede COMEÇA FRACO na escala 0–1000.
--
-- A 297 multiplicou os atributos por 10 (17 virou 170). Decisão do Alex
-- (2026-10-20): o começo é na casa das dezenas — inteligência 15–30, força
-- 15–30, velocidade 20–35 — e o caminho até 1000 é que é longo. Esta volta
-- divide por 10 inteligência, força, velocidade e os picos.
--
-- Idempotente: só pega linha cujo `attr_peaks` ainda não tem a marca
-- `start_low`, e grava a marca no mesmo UPDATE (rodar de novo não divide de
-- novo). O código preserva as chaves de `attr_peaks` ao salvar.

UPDATE public.tb_mm_character
   SET intelligence = intelligence / 10,
       strength = strength / 10,
       speed = speed / 10,
       attr_peaks = jsonb_build_object(
         'intelligence', COALESCE((attr_peaks ->> 'intelligence')::double precision, intelligence) / 10,
         'strength', COALESCE((attr_peaks ->> 'strength')::double precision, strength) / 10,
         'speed', COALESCE((attr_peaks ->> 'speed')::double precision, speed) / 10,
         'start_low', true
       )
 WHERE attr_peaks IS NOT NULL
   AND NOT (attr_peaks ? 'start_low');
