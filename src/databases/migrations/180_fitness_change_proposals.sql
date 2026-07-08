-- =============================================================================
-- Migration 180: Fitness — propostas de alteração do professor
-- Edições do staff (peso/altura, limite de calorias, fichas de treino) deixam
-- de aplicar direto: viram uma PROPOSTA que o aluno confirma ou recusa num
-- modal no /fitness. O painel fitness pessoal deixou de exigir matrícula/
-- assinatura (gate requireFitnessAccess removido) — academia é opcional.
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_fitness_change_proposal (
  id_proposal        UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_academy         UUID         NOT NULL REFERENCES public.tb_academy(id_academy) ON DELETE CASCADE,
  id_member          UUID         NOT NULL REFERENCES public.tb_academy_member(id_member) ON DELETE CASCADE,
  id_student_user    UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  id_professor_user  UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  kind               VARCHAR(16)  NOT NULL
                       CHECK (kind IN ('measurement','kcal_goal','plan_create','plan_update','plan_delete')),
  -- payload validado na criação (mesma sanitização do apply direto antigo):
  -- measurement {weight_kg?, height_cm?} · kcal_goal {daily_kcal_goal}
  -- plan_create {nome, notes?, exercises[]} · plan_update {id_plan, nome?, notes?, is_active?, exercises?}
  -- plan_delete {id_plan, plan_nome}
  payload            JSONB        NOT NULL DEFAULT '{}'::jsonb,
  status             VARCHAR(16)  NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','accepted','declined','canceled')),
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  resolved_at        TIMESTAMPTZ  NULL
);

CREATE INDEX IF NOT EXISTS idx_fitness_proposal_student_pending
  ON public.tb_fitness_change_proposal (id_student_user, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_fitness_proposal_member_pending
  ON public.tb_fitness_change_proposal (id_member, created_at)
  WHERE status = 'pending';
