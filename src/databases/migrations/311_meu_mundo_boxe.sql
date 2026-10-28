-- 311 — Meu Mundo 3D mm3d-43: Arena de Boxe.
--
-- O cartel do hóspede (vitórias, derrotas, empates e nocautes). A luta é
-- calculada pela sala (src/utils/meuMundoBoxe.js) e a consequência entra na
-- vida na transação de sempre; a lesão é um efeito (coluna effects) e as lutas
-- do dia ficam no diário (day_acc). NULL = nunca lutou.

ALTER TABLE tb_mm_character ADD COLUMN IF NOT EXISTS boxing JSONB;
