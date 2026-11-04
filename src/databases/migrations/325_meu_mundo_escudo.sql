-- 325 — Meu Mundo 3D: slot de escudo (mm3d-68, 2026-11-04).
--
-- Os escudos da Loja de Armas ocupam um slot próprio, ao lado da arma.
-- CHECK reescrito como SUPERSET, com o mesmo nome.

ALTER TABLE public.tb_mm_equip DROP CONSTRAINT IF EXISTS chk_mm_equip_slot;
ALTER TABLE public.tb_mm_equip ADD CONSTRAINT chk_mm_equip_slot CHECK (slot IN ('weapon', 'shield', 'armor', 'acc1', 'acc2'));
