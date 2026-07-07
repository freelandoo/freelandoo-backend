-- =============================================================================
-- Migration 178: Fitness & Academias — Fase 3 (treinos)
-- Biblioteca global de exercícios (seedada aqui) + fichas montadas pelo
-- professor para um membro da academia + sessões diárias com check por
-- exercício (todos checados ⇒ sessão concluída). Idempotente.
-- =============================================================================

-- ─── 1. Biblioteca de exercícios ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_exercise (
  id_exercise  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nome         TEXT        NOT NULL UNIQUE,
  muscle_group VARCHAR(16) NOT NULL CHECK (muscle_group IN
    ('peito','costas','ombros','biceps','triceps','pernas','gluteos','abdomen','cardio','corpo_inteiro')),
  is_active    BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.tb_exercise (nome, muscle_group) VALUES
  ('Supino reto com barra', 'peito'),
  ('Supino inclinado com halteres', 'peito'),
  ('Supino declinado', 'peito'),
  ('Crucifixo reto', 'peito'),
  ('Crucifixo inclinado', 'peito'),
  ('Crossover na polia', 'peito'),
  ('Peck deck (voador)', 'peito'),
  ('Flexão de braço', 'peito'),
  ('Supino máquina', 'peito'),
  ('Pullover com halter', 'peito'),
  ('Puxada frontal (pulley)', 'costas'),
  ('Puxada atrás da nuca', 'costas'),
  ('Remada curvada com barra', 'costas'),
  ('Remada unilateral (serrote)', 'costas'),
  ('Remada baixa (triângulo)', 'costas'),
  ('Remada cavalinho', 'costas'),
  ('Barra fixa', 'costas'),
  ('Levantamento terra', 'costas'),
  ('Remada máquina', 'costas'),
  ('Pulldown com corda', 'costas'),
  ('Hiperextensão lombar', 'costas'),
  ('Desenvolvimento com barra', 'ombros'),
  ('Desenvolvimento com halteres', 'ombros'),
  ('Desenvolvimento Arnold', 'ombros'),
  ('Elevação lateral', 'ombros'),
  ('Elevação frontal', 'ombros'),
  ('Elevação lateral na polia', 'ombros'),
  ('Crucifixo invertido', 'ombros'),
  ('Face pull', 'ombros'),
  ('Encolhimento com halteres', 'ombros'),
  ('Remada alta', 'ombros'),
  ('Rosca direta com barra', 'biceps'),
  ('Rosca alternada com halteres', 'biceps'),
  ('Rosca martelo', 'biceps'),
  ('Rosca scott', 'biceps'),
  ('Rosca concentrada', 'biceps'),
  ('Rosca na polia baixa', 'biceps'),
  ('Rosca 21', 'biceps'),
  ('Rosca inversa', 'biceps'),
  ('Tríceps na polia (corda)', 'triceps'),
  ('Tríceps na polia (barra)', 'triceps'),
  ('Tríceps testa', 'triceps'),
  ('Tríceps francês', 'triceps'),
  ('Mergulho no banco', 'triceps'),
  ('Mergulho nas paralelas', 'triceps'),
  ('Tríceps coice (kickback)', 'triceps'),
  ('Supino fechado', 'triceps'),
  ('Agachamento livre', 'pernas'),
  ('Agachamento no smith', 'pernas'),
  ('Agachamento búlgaro', 'pernas'),
  ('Agachamento sumô', 'pernas'),
  ('Leg press 45°', 'pernas'),
  ('Cadeira extensora', 'pernas'),
  ('Mesa flexora', 'pernas'),
  ('Cadeira flexora', 'pernas'),
  ('Afundo (passada)', 'pernas'),
  ('Levantamento terra romeno', 'pernas'),
  ('Panturrilha em pé', 'pernas'),
  ('Panturrilha sentado', 'pernas'),
  ('Cadeira adutora', 'pernas'),
  ('Cadeira abdutora', 'pernas'),
  ('Hack squat', 'pernas'),
  ('Elevação pélvica (hip thrust)', 'gluteos'),
  ('Glúteo na polia (coice)', 'gluteos'),
  ('Glúteo quatro apoios', 'gluteos'),
  ('Abdução de quadril com caneleira', 'gluteos'),
  ('Ponte de glúteo', 'gluteos'),
  ('Stiff', 'gluteos'),
  ('Abdominal supra', 'abdomen'),
  ('Abdominal infra', 'abdomen'),
  ('Abdominal oblíquo', 'abdomen'),
  ('Prancha isométrica', 'abdomen'),
  ('Prancha lateral', 'abdomen'),
  ('Abdominal na polia (crunch)', 'abdomen'),
  ('Elevação de pernas na barra', 'abdomen'),
  ('Abdominal máquina', 'abdomen'),
  ('Russian twist', 'abdomen'),
  ('Roda abdominal', 'abdomen'),
  ('Esteira (caminhada)', 'cardio'),
  ('Esteira (corrida)', 'cardio'),
  ('Bicicleta ergométrica', 'cardio'),
  ('Elíptico (transport)', 'cardio'),
  ('Escada (stair climber)', 'cardio'),
  ('Remo ergômetro', 'cardio'),
  ('Pular corda', 'cardio'),
  ('HIIT na esteira', 'cardio'),
  ('Spinning', 'cardio'),
  ('Burpee', 'corpo_inteiro'),
  ('Clean and press', 'corpo_inteiro'),
  ('Kettlebell swing', 'corpo_inteiro'),
  ('Thruster', 'corpo_inteiro'),
  ('Snatch com halter', 'corpo_inteiro'),
  ('Wall ball', 'corpo_inteiro'),
  ('Battle rope', 'corpo_inteiro'),
  ('Farmer walk', 'corpo_inteiro'),
  ('Mountain climber', 'corpo_inteiro'),
  ('Turkish get-up', 'corpo_inteiro')
ON CONFLICT (nome) DO NOTHING;

-- ─── 2. Fichas (professor → aluno) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_workout_plan (
  id_plan     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  id_academy  UUID        NOT NULL REFERENCES public.tb_academy(id_academy) ON DELETE CASCADE,
  id_member   UUID        NOT NULL REFERENCES public.tb_academy_member(id_member) ON DELETE CASCADE,
  created_by  UUID        NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  nome        TEXT        NOT NULL,
  notes       TEXT        NULL,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workout_plan_member
  ON public.tb_workout_plan (id_member, is_active);

CREATE TABLE IF NOT EXISTS public.tb_workout_plan_exercise (
  id_plan_exercise UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_plan          UUID         NOT NULL REFERENCES public.tb_workout_plan(id_plan) ON DELETE CASCADE,
  id_exercise      UUID         NOT NULL REFERENCES public.tb_exercise(id_exercise) ON DELETE RESTRICT,
  sets             INT          NOT NULL DEFAULT 3 CHECK (sets BETWEEN 1 AND 20),
  reps             TEXT         NOT NULL DEFAULT '10',
  load_kg          NUMERIC(6,2) NULL,
  rest_seconds     INT          NULL CHECK (rest_seconds IS NULL OR rest_seconds BETWEEN 0 AND 900),
  position         INT          NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_workout_plan_exercise_plan
  ON public.tb_workout_plan_exercise (id_plan, position);

-- ─── 3. Sessões + checks ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_workout_session (
  id_session   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  id_plan      UUID        NOT NULL REFERENCES public.tb_workout_plan(id_plan) ON DELETE CASCADE,
  id_member    UUID        NOT NULL REFERENCES public.tb_academy_member(id_member) ON DELETE CASCADE,
  session_date DATE        NOT NULL,
  completed_at TIMESTAMPTZ NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ux_workout_session_day UNIQUE (id_plan, session_date)
);

CREATE INDEX IF NOT EXISTS idx_workout_session_member
  ON public.tb_workout_session (id_member, session_date DESC);

CREATE TABLE IF NOT EXISTS public.tb_workout_check (
  id_session       UUID        NOT NULL REFERENCES public.tb_workout_session(id_session) ON DELETE CASCADE,
  id_plan_exercise UUID        NOT NULL REFERENCES public.tb_workout_plan_exercise(id_plan_exercise) ON DELETE CASCADE,
  checked_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_session, id_plan_exercise)
);
