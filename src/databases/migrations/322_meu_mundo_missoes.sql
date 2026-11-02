-- 322 — MEU MUNDO 3D mm3d-59 (reforma, slice 5): MISSÕES (o prólogo "O Despertar de Lúmen").
--
-- Regra em src/utils/meuMundoQuests.js; quem confere é MeuMundoQuestService.
-- Missão é da PESSOA (atravessa gerações). `step` = o passo em curso (0-based);
-- `step_at` = quando ele abriu (objetivos "depois que o passo abriu" contam daí);
-- `done_at` preenchido = concluída. Uma missão principal acompanhada por vez
-- (`tracked` no máximo uma por pessoa — índice único parcial).
-- Recompensa de cada passo = recibo único em tb_mm_receipt (source 'quest').

CREATE TABLE IF NOT EXISTS public.tb_mm_quest (
  id_user UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  quest_id TEXT NOT NULL,
  step INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  step_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  done_at TIMESTAMPTZ NULL,
  tracked BOOLEAN NOT NULL DEFAULT TRUE,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (id_user, quest_id),
  CONSTRAINT chk_mm_quest_step CHECK (step >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_mm_quest_tracked ON public.tb_mm_quest (id_user) WHERE tracked AND done_at IS NULL;
