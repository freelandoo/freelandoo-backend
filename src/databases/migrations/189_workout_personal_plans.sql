-- =============================================================================
-- Migration 189: Fitness — ficha de treino é do USUÁRIO (não do vínculo)
-- Até aqui a ficha (mig 178) só existia dentro de uma academia: id_academy e
-- id_member eram NOT NULL, então quem não tem matrícula não podia ter treino
-- nenhum — incoerente com a mig 180, que tornou o /fitness PESSOAL.
-- Aqui a posse passa pra tb_user: o aluno cria a própria ficha (aplica direto,
-- é dele) e o professor da academia em que ele está matriculado continua vendo
-- e podendo alterar — mas via proposta (mig 180), aprovada no modal do aluno.
-- id_academy/id_member viram opcionais e só guardam o CONTEXTO de criação;
-- desvincular da academia não pode mais apagar o histórico de treino, então
-- as FKs passam de ON DELETE CASCADE para SET NULL.
-- Idempotente.
-- =============================================================================

-- ─── 1. Fichas ───────────────────────────────────────────────────────────────
ALTER TABLE public.tb_workout_plan
  ADD COLUMN IF NOT EXISTS id_user UUID NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE;

-- Backfill: o dono é o usuário por trás do vínculo (id_member era NOT NULL com
-- FK, então toda linha existente resolve).
UPDATE public.tb_workout_plan p
   SET id_user = m.id_user
  FROM public.tb_academy_member m
 WHERE m.id_member = p.id_member
   AND p.id_user IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tb_workout_plan WHERE id_user IS NULL) THEN
    ALTER TABLE public.tb_workout_plan ALTER COLUMN id_user SET NOT NULL;
  END IF;
END $$;

ALTER TABLE public.tb_workout_plan ALTER COLUMN id_academy DROP NOT NULL;
ALTER TABLE public.tb_workout_plan ALTER COLUMN id_member  DROP NOT NULL;

-- Derruba a FK atual da coluna seja qual for o nome dela (não confiar no nome
-- default) e recria com SET NULL.
DO $$
DECLARE c TEXT;
BEGIN
  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = rel.relnamespace
      JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = con.conkey[1]
     WHERE ns.nspname = 'public' AND rel.relname = 'tb_workout_plan'
       AND con.contype = 'f' AND array_length(con.conkey, 1) = 1
       AND att.attname = 'id_academy'
  LOOP
    EXECUTE format('ALTER TABLE public.tb_workout_plan DROP CONSTRAINT %I', c);
  END LOOP;

  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = rel.relnamespace
      JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = con.conkey[1]
     WHERE ns.nspname = 'public' AND rel.relname = 'tb_workout_plan'
       AND con.contype = 'f' AND array_length(con.conkey, 1) = 1
       AND att.attname = 'id_member'
  LOOP
    EXECUTE format('ALTER TABLE public.tb_workout_plan DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE public.tb_workout_plan
  ADD CONSTRAINT tb_workout_plan_id_academy_fkey
  FOREIGN KEY (id_academy) REFERENCES public.tb_academy(id_academy) ON DELETE SET NULL;

ALTER TABLE public.tb_workout_plan
  ADD CONSTRAINT tb_workout_plan_id_member_fkey
  FOREIGN KEY (id_member) REFERENCES public.tb_academy_member(id_member) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_workout_plan_user
  ON public.tb_workout_plan (id_user, is_active);

-- ─── 2. Sessões ──────────────────────────────────────────────────────────────
ALTER TABLE public.tb_workout_session
  ADD COLUMN IF NOT EXISTS id_user UUID NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE;

UPDATE public.tb_workout_session s
   SET id_user = m.id_user
  FROM public.tb_academy_member m
 WHERE m.id_member = s.id_member
   AND s.id_user IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tb_workout_session WHERE id_user IS NULL) THEN
    ALTER TABLE public.tb_workout_session ALTER COLUMN id_user SET NOT NULL;
  END IF;
END $$;

ALTER TABLE public.tb_workout_session ALTER COLUMN id_member DROP NOT NULL;

DO $$
DECLARE c TEXT;
BEGIN
  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = rel.relnamespace
      JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = con.conkey[1]
     WHERE ns.nspname = 'public' AND rel.relname = 'tb_workout_session'
       AND con.contype = 'f' AND array_length(con.conkey, 1) = 1
       AND att.attname = 'id_member'
  LOOP
    EXECUTE format('ALTER TABLE public.tb_workout_session DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE public.tb_workout_session
  ADD CONSTRAINT tb_workout_session_id_member_fkey
  FOREIGN KEY (id_member) REFERENCES public.tb_academy_member(id_member) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_workout_session_user
  ON public.tb_workout_session (id_user, session_date DESC);
