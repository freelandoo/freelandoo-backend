-- 324 — Meu Mundo 3D: o que o sono rendeu (2026-11-03).
--
-- Ao acordar, sobe na tela o estresse que saiu (regra do Alex). Guarda
-- { from, woke }: como ele estava ao deitar e o resultado até a pessoa ver —
-- quem dorme com o jogo fechado vê ao voltar. NULL = nada pendente.

ALTER TABLE tb_mm_character ADD COLUMN IF NOT EXISTS sleep_note JSONB;
