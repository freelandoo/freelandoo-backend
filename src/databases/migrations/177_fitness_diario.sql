-- =============================================================================
-- Migration 177: Fitness & Academias — Fase 2 (diário fitness)
-- Contador de calorias (tb_food: TACO seedada por script + cache Open Food
-- Facts + custom), água, medidas corporais (aluno E professor registram) e
-- metas pessoais. Acesso gated: matrícula ativa OU subperfil pago
-- (middleware requireFitnessAccess). Idempotente.
-- =============================================================================

-- ─── 1. Catálogo de alimentos ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_food (
  id_food      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  source       VARCHAR(8)   NOT NULL CHECK (source IN ('taco','off','custom')),
  external_ref TEXT         NULL, -- código TACO ou barcode/id do Open Food Facts
  nome         TEXT         NOT NULL,
  kcal_100g    NUMERIC(8,2) NOT NULL DEFAULT 0,
  protein_g    NUMERIC(8,2) NOT NULL DEFAULT 0,
  carbs_g      NUMERIC(8,2) NOT NULL DEFAULT 0,
  fat_g        NUMERIC(8,2) NOT NULL DEFAULT 0,
  created_by   UUID         NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_food_source_ref
  ON public.tb_food (source, external_ref)
  WHERE external_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_food_nome ON public.tb_food (LOWER(nome));

-- ─── 2. Diário de refeições ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_fitness_food_log (
  id_log     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user    UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  log_date   DATE         NOT NULL,
  meal       VARCHAR(8)   NOT NULL CHECK (meal IN ('cafe','almoco','jantar','lanche')),
  id_food    UUID         NOT NULL REFERENCES public.tb_food(id_food) ON DELETE RESTRICT,
  quantity_g NUMERIC(8,2) NOT NULL CHECK (quantity_g > 0),
  -- snapshots (editar o alimento depois não reescreve o histórico)
  kcal       NUMERIC(8,2) NOT NULL,
  protein_g  NUMERIC(8,2) NOT NULL DEFAULT 0,
  carbs_g    NUMERIC(8,2) NOT NULL DEFAULT 0,
  fat_g      NUMERIC(8,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fitness_food_log_user_date
  ON public.tb_fitness_food_log (id_user, log_date);

-- ─── 3. Água (1 linha por dia) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_fitness_water_log (
  id_user   UUID        NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  log_date  DATE        NOT NULL,
  total_ml  INT         NOT NULL DEFAULT 0 CHECK (total_ml >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_user, log_date)
);

-- ─── 4. Medidas corporais (histórico; aluno E professor registram) ──────────
CREATE TABLE IF NOT EXISTS public.tb_fitness_measurement (
  id_measurement UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user        UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  weight_kg      NUMERIC(6,2) NULL CHECK (weight_kg IS NULL OR (weight_kg > 0 AND weight_kg < 500)),
  height_cm      NUMERIC(6,2) NULL CHECK (height_cm IS NULL OR (height_cm > 0 AND height_cm < 300)),
  recorded_by    UUID         NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  measured_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fitness_measurement_user
  ON public.tb_fitness_measurement (id_user, measured_at DESC);

-- ─── 5. Metas pessoais ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_fitness_settings (
  id_user         UUID PRIMARY KEY REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  daily_kcal_goal INT  NOT NULL DEFAULT 2000 CHECK (daily_kcal_goal BETWEEN 500 AND 10000),
  water_goal_ml   INT  NOT NULL DEFAULT 2000 CHECK (water_goal_ml BETWEEN 250 AND 10000),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
