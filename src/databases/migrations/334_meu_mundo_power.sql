-- 334 — Meu Mundo 3D: PODER do personagem (T3, 2026-11-08).
--
-- poder = HP×0,5 + ataque×3 + defesa×2 + (força + velocidade + inteligência)×10
--         + bônus de equipamento (regra única em src/utils/meuMundoPower.js, GERADA
--         do front features/meu-mundo/power/power.ts).
-- Gravado a cada mudança da vida (MeuMundoLifeService.withLife). NULL = ainda não
-- calculado: o backfill roda sozinho no boot (MeuMundoPowerService.backfill, só as
-- linhas NULL) e também por scripts/backfill-mm-power.js. Usado depois pela tela de
-- Status, pelo ranking/Hall e pelos prêmios — por isso o índice.

ALTER TABLE tb_mm_character ADD COLUMN IF NOT EXISTS power INTEGER;

CREATE INDEX IF NOT EXISTS idx_mm_character_power
  ON tb_mm_character (power DESC NULLS LAST);
