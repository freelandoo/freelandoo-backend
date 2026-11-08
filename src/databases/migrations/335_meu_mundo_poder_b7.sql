-- 335 — MEU MUNDO 3D B7 (2026-11-08): ACURÁCIA, PODER pela fórmula do B7 e ranking.
--
-- Decisão do Alex: o PODER é a soma simples do permanente —
--   força + velocidade + destreza + inteligência + acurácia + HP máx do nível + equipamento
--   (cada 1% de bônus = 10 pontos), sem suplemento. Regra única em
--   features/meu-mundo/power/power.ts (front) → src/utils/meuMundoPower.js (gerado).
-- Substitui a fórmula do T3 (mig 334), que estava errada. Reaproveita a coluna
-- tb_mm_character.power e o índice idx_mm_character_power da 334.
--
-- Acurácia: atributo novo de prática, mesma escala e decaimento dos outros
-- (utils/meuMundoLife.js ATTR); todos começam em 0 (o B10 faz o saco de pancada treiná-la).

ALTER TABLE public.tb_mm_character ADD COLUMN IF NOT EXISTS accuracy DOUBLE PRECISION NOT NULL DEFAULT 0;
UPDATE public.tb_mm_character
   SET attr_peaks = attr_peaks || jsonb_build_object('accuracy', 0)
 WHERE attr_peaks IS NOT NULL AND NOT (attr_peaks ? 'accuracy');

-- Quando o poder mudou pela última vez: desempate do ranking (quem chegou antes fica na frente).
ALTER TABLE public.tb_mm_character ADD COLUMN IF NOT EXISTS power_at TIMESTAMPTZ;

-- Recalcular TODOS pela fórmula nova: NULL = o backfill do boot
-- (MeuMundoPowerService.backfill, 15 s depois de subir) refaz cada linha; quem entrar antes
-- já sai certo pelo withLife.
UPDATE public.tb_mm_character SET power = NULL, power_at = NULL WHERE power IS NOT NULL;

-- Top 100 do Poder: só os vivos (um vivo por pessoa — ux_mm_character_alive da 295).
CREATE INDEX IF NOT EXISTS idx_mm_character_power_rank
  ON public.tb_mm_character (power DESC, power_at ASC)
  WHERE status = 'alive' AND power IS NOT NULL;

-- Ranking por nível: lê tb_mm_adventure (por pessoa).
CREATE INDEX IF NOT EXISTS ix_mm_adventure_rank ON public.tb_mm_adventure (level DESC, xp DESC);
