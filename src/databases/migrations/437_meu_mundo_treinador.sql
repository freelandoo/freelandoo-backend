-- 437 — MEU MUNDO: nível do TREINADOR (lore v2, etapa F2; regra do Alex, 2026-11-09).
--
-- O treinador é a CONTA: o nível dele não zera quando a pessoa troca de personagem
-- (o nível de aventura continua por personagem, mig 435). Os capítulos da história
-- (1 a 10) abrem pelo nível do treinador (1 a 30). Ele ganha o XP inteiro das missões
-- e uma fração de minijogo, luta, Domínio, cuidar e treinar, com teto por dia
-- (regra em src/utils/meuMundoTrainer.js).
--
-- Todo mundo começa no nível 1 (decisão do Alex: sem semente, sem XP retroativo).
--
-- gain_day / gain_today: quanto da parte com teto (tudo menos missão) já entrou no dia
-- de Brasília. care_day / care_meals / train_hours: o que do diário da vida (refeições
-- e horas úteis de treino/estudo) já virou XP naquele dia — contadores travados junto
-- da vida (withLife), então duas abas não contam duas vezes.
--
-- Idempotente (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS public.tb_mm_trainer (
  id_user UUID PRIMARY KEY REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  xp BIGINT NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  gain_day DATE NULL,
  gain_today INTEGER NOT NULL DEFAULT 0,
  care_day DATE NULL,
  care_meals INTEGER NOT NULL DEFAULT 0,
  train_hours INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_mm_trainer_xp CHECK (xp >= 0),
  CONSTRAINT chk_mm_trainer_level CHECK (level >= 1)
);

CREATE INDEX IF NOT EXISTS ix_mm_trainer_rank ON public.tb_mm_trainer (level DESC, xp DESC);
