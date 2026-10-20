-- 295 — MEU MUNDO 3D (mm3d-13): a VIDA do hóspede.
--
-- O personagem de cada usuário passa a ter vitais, corpo, doenças, atributos,
-- personalidade e uma atividade que continua com o jogo fechado. A regra mora
-- em src/utils/meuMundoLife.js (simulação PREGUIÇOSA: quem lê ou age trava a
-- linha, simula de `sim_at` até agora e grava — não existe job).
--
-- Um hóspede por geração: morreu, a linha fica (histórico) e o próximo nasce
-- com `generation + 1`. No máximo UM vivo por usuário (índice único parcial).
--
-- ISOLAMENTO: `tb_mm_wallet` são moedas DO JOGO (ambiente dev), sem relação
-- com saldo, Poléns, Carteira ou qualquer patrimônio da Freelandoo.

CREATE TABLE IF NOT EXISTS public.tb_mm_character (
  id_character UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  generation INTEGER NOT NULL DEFAULT 1,
  seed INTEGER NOT NULL,
  personality JSONB NOT NULL,
  height_m NUMERIC(3, 2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'alive',
  born_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  died_at TIMESTAMPTZ NULL,
  death_cause TEXT NULL,
  death_seen_at TIMESTAMPTZ NULL,
  -- vitais (0–100)
  energy DOUBLE PRECISION NOT NULL,
  satiety DOUBLE PRECISION NOT NULL,
  mood DOUBLE PRECISION NOT NULL,
  stress DOUBLE PRECISION NOT NULL,
  health DOUBLE PRECISION NOT NULL,
  vitality DOUBLE PRECISION NOT NULL,
  -- corpo
  fat_kg DOUBLE PRECISION NOT NULL,
  lean_kg DOUBLE PRECISION NOT NULL,
  -- metabolismo e doenças
  diabetes_risk DOUBLE PRECISION NOT NULL DEFAULT 0,
  has_diabetes BOOLEAN NOT NULL DEFAULT FALSE,
  bp_risk DOUBLE PRECISION NOT NULL DEFAULT 0,
  has_hypertension BOOLEAN NOT NULL DEFAULT FALSE,
  toxicity DOUBLE PRECISION NOT NULL DEFAULT 0,
  cardiac DOUBLE PRECISION NOT NULL DEFAULT 0,
  awake_h DOUBLE PRECISION NOT NULL DEFAULT 0,
  zero_energy_h DOUBLE PRECISION NOT NULL DEFAULT 0,
  diet DOUBLE PRECISION NOT NULL DEFAULT 0,
  -- atributos (0–100)
  intelligence DOUBLE PRECISION NOT NULL,
  strength DOUBLE PRECISION NOT NULL,
  speed DOUBLE PRECISION NOT NULL,
  fertility DOUBLE PRECISION NOT NULL,
  -- atividade em curso
  activity TEXT NOT NULL DEFAULT 'idle',
  activity_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activity_until TIMESTAMPTZ NULL,
  activity_bed JSONB NULL,
  activity_resume JSONB NULL,
  -- efeitos temporários (suplementos, remédios, estimulantes…), refeições de
  -- hoje e o diário do dia em curso
  effects JSONB NOT NULL DEFAULT '[]'::jsonb,
  meals JSONB NOT NULL,
  day_acc JSONB NOT NULL,
  sim_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_mm_character_status CHECK (status IN ('alive', 'dead')),
  CONSTRAINT chk_mm_character_dead CHECK ((status = 'dead') = (died_at IS NOT NULL)),
  CONSTRAINT chk_mm_character_activity CHECK (
    activity IN ('idle', 'lying', 'sleeping', 'studying', 'training', 'working', 'hospital')
  ),
  CONSTRAINT chk_mm_character_generation CHECK (generation >= 1),
  CONSTRAINT ux_mm_character_generation UNIQUE (id_user, generation)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_mm_character_alive
  ON public.tb_mm_character (id_user) WHERE status = 'alive';

-- Diário: um registro por hóspede por dia do relógio do jogo (Brasília). O dia
-- em curso também é gravado (parcial) para os cards mostrarem "hoje".
CREATE TABLE IF NOT EXISTS public.tb_mm_character_day (
  id_character UUID NOT NULL REFERENCES public.tb_mm_character(id_character) ON DELETE CASCADE,
  day DATE NOT NULL,
  closed BOOLEAN NOT NULL DEFAULT FALSE,
  hours JSONB NOT NULL,
  meals_eaten SMALLINT NOT NULL DEFAULT 0,
  meals_missed SMALLINT NOT NULL DEFAULT 0,
  healthy_count SMALLINT NOT NULL DEFAULT 0,
  junk_count SMALLINT NOT NULL DEFAULT 0,
  avg_mood DOUBLE PRECISION NULL,
  min_health DOUBLE PRECISION NOT NULL,
  max_stress DOUBLE PRECISION NOT NULL,
  coins_earned DOUBLE PRECISION NOT NULL DEFAULT 0,
  condition_score SMALLINT NOT NULL,
  condition_label TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_character, day),
  CONSTRAINT chk_mm_character_day_label CHECK (condition_label IN ('otima', 'boa', 'regular', 'ruim', 'critica'))
);

-- Linha do tempo (comeu, desmaiou, internou, infartou, morreu…). Só cresce.
CREATE TABLE IF NOT EXISTS public.tb_mm_character_event (
  id_event BIGSERIAL PRIMARY KEY,
  id_character UUID NOT NULL REFERENCES public.tb_mm_character(id_character) ON DELETE CASCADE,
  at TIMESTAMPTZ NOT NULL,
  kind TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS ix_mm_character_event_char_at
  ON public.tb_mm_character_event (id_character, at DESC);

-- Moedas do jogo, por PESSOA (passam de um hóspede para o próximo).
CREATE TABLE IF NOT EXISTS public.tb_mm_wallet (
  id_user UUID PRIMARY KEY REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  coins DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_mm_wallet_coins CHECK (coins >= 0)
);
