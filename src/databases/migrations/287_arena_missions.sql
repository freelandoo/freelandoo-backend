-- =============================================================================
-- Migration 287: Freelandoo Arena — fatos, missões, XP da Arena e aquecimento x2 (M12)
-- =============================================================================
-- O "XP da Arena" é progressão PESSOAL do jogo. Ele NÃO usa nada do XP da
-- plataforma (tb_profile.xp_total, XpStorage.recalcProfileXp), que concede
-- Poléns por nível e propaga para clã/comunidade. Não tem conversão monetária,
-- não altera ranking, movimento nem território.
--
--   tb_arena_fact               — OUTBOX durável. Cada fato aceito por uma
--                                 autoridade (checkpoint aceito, visita a poste
--                                 atestada pelo servidor de jogo, conclusão
--                                 elegível de vídeo) é inserido NA MESMA
--                                 transação da autoridade. Único por
--                                 (tipo, conta, referência da origem).
--                                 processed_at nulo = pendente (varredura
--                                 recupera depois de reinício).
--   tb_arena_mission_def        — catálogo VERSIONADO (scripts/arena-missions.js
--                                 a partir de seeds/arena-missions.json). Nenhuma
--                                 expressão executável: tipo de fato, objetivo e
--                                 meta saem de listas fechadas.
--   tb_arena_mission_progress   — progresso por conta + missão + ciclo. A versão
--                                 é FIXADA na primeira contribuição do ciclo.
--   tb_arena_mission_contrib    — contribuições deduplicadas: um fato não conta
--                                 duas vezes; em objetivo "distinto", a mesma
--                                 chave (ex.: o mesmo poste) não conta duas vezes.
--   tb_arena_xp_grant           — LEDGER imutável de concessões. Uma por
--                                 conta + missão + ciclo, independente da versão
--                                 da regra (mudar a versão não reabre o prêmio).
--   tb_arena_progression        — saldo de XP da Arena (derivado do ledger,
--                                 atualizado na mesma transação da concessão).
--   tb_arena_boost              — ativação do aquecimento x2. Origem única
--                                 (repetir a conclusão não cria outra). Só é
--                                 criada com ARENA_BOOST_ENABLED=true.
--
-- Ordem de travas: conta (pg_advisory_xact_lock por id_user) antes de qualquer
-- linha de missão/progressão/bônus. Nenhum caminho trava na ordem inversa.
--
-- Recuperação:
--   DROP TABLE public.tb_arena_boost, public.tb_arena_progression,
--              public.tb_arena_xp_grant, public.tb_arena_mission_contrib,
--              public.tb_arena_mission_progress, public.tb_arena_mission_def,
--              public.tb_arena_fact CASCADE;
--   DROP FUNCTION public.fn_arena_xp_grant_immutable();
--   DELETE FROM public.schema_migrations WHERE filename = '287_arena_missions.sql';
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_arena_fact (
  id_fact         BIGSERIAL     PRIMARY KEY,
  id_user         UUID          NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  fact_type       VARCHAR(32)   NOT NULL,
  source_ref      VARCHAR(160)  NOT NULL,
  environment_id  VARCHAR(48),
  -- Instante AUTORITATIVO do fato (relógio do banco na transação da autoridade).
  occurred_at     TIMESTAMPTZ   NOT NULL,
  -- Só o mínimo para auditoria. Nunca categoria/equipe (preferência sensível).
  payload         JSONB         NOT NULL DEFAULT '{}'::jsonb,
  processed_at    TIMESTAMPTZ,
  attempts        INTEGER       NOT NULL DEFAULT 0,
  last_error      VARCHAR(200),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT chk_arena_fact_type CHECK (fact_type IN ('checkpoint_accepted', 'post_visited', 'video_completed'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_arena_fact_source ON public.tb_arena_fact (fact_type, id_user, source_ref);
CREATE INDEX IF NOT EXISTS ix_arena_fact_pending ON public.tb_arena_fact (occurred_at) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_arena_fact_user ON public.tb_arena_fact (id_user, occurred_at);

CREATE TABLE IF NOT EXISTS public.tb_arena_mission_def (
  mission_key     VARCHAR(48)   NOT NULL,
  version         INTEGER       NOT NULL,
  status          VARCHAR(12)   NOT NULL,
  fact_type       VARCHAR(32)   NOT NULL,
  objective       VARCHAR(12)   NOT NULL,
  target          INTEGER       NOT NULL,
  cycle           VARCHAR(12)   NOT NULL,
  reward_xp       INTEGER       NOT NULL,
  x2_eligible     BOOLEAN       NOT NULL DEFAULT FALSE,
  requirement     VARCHAR(24)   NOT NULL DEFAULT 'none',
  voluntary       BOOLEAN       NOT NULL DEFAULT FALSE,
  sort_order      INTEGER       NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (mission_key, version),
  CONSTRAINT chk_arena_mission_key CHECK (mission_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT chk_arena_mission_status CHECK (status IN ('active', 'disabled', 'retired')),
  CONSTRAINT chk_arena_mission_fact CHECK (fact_type IN ('checkpoint_accepted', 'post_visited', 'video_completed')),
  CONSTRAINT chk_arena_mission_objective CHECK (objective IN ('count', 'distinct')),
  CONSTRAINT chk_arena_mission_target CHECK (target BETWEEN 1 AND 100),
  CONSTRAINT chk_arena_mission_cycle CHECK (cycle IN ('daily_utc')),
  CONSTRAINT chk_arena_mission_reward CHECK (reward_xp BETWEEN 0 AND 10000),
  CONSTRAINT chk_arena_mission_requirement CHECK (requirement IN ('none', 'game_server', 'competitive_posts', 'video_campaign'))
);
-- No máximo UMA versão vigente (ativa ou desligada) por missão lógica.
CREATE UNIQUE INDEX IF NOT EXISTS ux_arena_mission_current
  ON public.tb_arena_mission_def (mission_key) WHERE status IN ('active', 'disabled');

CREATE TABLE IF NOT EXISTS public.tb_arena_mission_progress (
  id_user          UUID          NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  mission_key      VARCHAR(48)   NOT NULL,
  cycle_key        DATE          NOT NULL,
  mission_version  INTEGER       NOT NULL,
  target           INTEGER       NOT NULL,
  progress         INTEGER       NOT NULL DEFAULT 0,
  completed_at     TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id_user, mission_key, cycle_key),
  CONSTRAINT fk_arena_mission_progress_def FOREIGN KEY (mission_key, mission_version)
    REFERENCES public.tb_arena_mission_def(mission_key, version),
  CONSTRAINT chk_arena_mission_progress CHECK (progress >= 0 AND progress <= target)
);

CREATE TABLE IF NOT EXISTS public.tb_arena_mission_contrib (
  id_user          UUID          NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  mission_key      VARCHAR(48)   NOT NULL,
  cycle_key        DATE          NOT NULL,
  contrib_key      VARCHAR(160)  NOT NULL,
  id_fact          BIGINT        NOT NULL REFERENCES public.tb_arena_fact(id_fact) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id_user, mission_key, cycle_key, contrib_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_arena_mission_contrib_fact
  ON public.tb_arena_mission_contrib (id_user, mission_key, cycle_key, id_fact);

CREATE TABLE IF NOT EXISTS public.tb_arena_boost (
  id_boost        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user         UUID          NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  origin_kind     VARCHAR(16)   NOT NULL,
  origin_ref      VARCHAR(64)   NOT NULL,
  policy_version  INTEGER       NOT NULL,
  factor          SMALLINT      NOT NULL DEFAULT 2,
  starts_at       TIMESTAMPTZ   NOT NULL,
  expires_at      TIMESTAMPTZ   NOT NULL,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT chk_arena_boost_origin CHECK (origin_kind IN ('video_session')),
  -- Fator máximo 2: nunca x4/x8.
  CONSTRAINT chk_arena_boost_factor CHECK (factor = 2),
  CONSTRAINT chk_arena_boost_window CHECK (expires_at > starts_at AND expires_at <= starts_at + INTERVAL '2 hours')
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_arena_boost_origin ON public.tb_arena_boost (origin_kind, origin_ref);
CREATE INDEX IF NOT EXISTS ix_arena_boost_user ON public.tb_arena_boost (id_user, starts_at);

CREATE TABLE IF NOT EXISTS public.tb_arena_xp_grant (
  id_grant         UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user          UUID          NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  source_kind      VARCHAR(16)   NOT NULL DEFAULT 'mission',
  mission_key      VARCHAR(48)   NOT NULL,
  mission_version  INTEGER       NOT NULL,
  cycle_key        DATE          NOT NULL,
  id_fact          BIGINT        NOT NULL,
  fact_type        VARCHAR(32)   NOT NULL,
  fact_at          TIMESTAMPTZ   NOT NULL,
  base_xp          INTEGER       NOT NULL,
  factor           SMALLINT      NOT NULL,
  xp               INTEGER       NOT NULL,
  id_boost         UUID,
  rule_version     INTEGER       NOT NULL,
  granted_at       TIMESTAMPTZ   NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT chk_arena_xp_grant_source CHECK (source_kind IN ('mission')),
  CONSTRAINT chk_arena_xp_grant_factor CHECK (factor IN (1, 2)),
  CONSTRAINT chk_arena_xp_grant_math CHECK (xp = base_xp * factor AND base_xp >= 0),
  CONSTRAINT chk_arena_xp_grant_boost CHECK ((factor = 2) = (id_boost IS NOT NULL))
);
-- A chave da concessão: conta + missão lógica + ciclo. A versão NÃO entra.
CREATE UNIQUE INDEX IF NOT EXISTS ux_arena_xp_grant_key ON public.tb_arena_xp_grant (id_user, mission_key, cycle_key);
CREATE INDEX IF NOT EXISTS ix_arena_xp_grant_user ON public.tb_arena_xp_grant (id_user, granted_at DESC);

-- Ledger imutável: nenhuma linha muda depois de escrita. (Excluir a CONTA leva o
-- histórico junto, por CASCADE — é dado pessoal.)
CREATE OR REPLACE FUNCTION public.fn_arena_xp_grant_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'arena_xp_grant_immutable' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_arena_xp_grant_immutable ON public.tb_arena_xp_grant;
CREATE TRIGGER trg_arena_xp_grant_immutable
  BEFORE UPDATE ON public.tb_arena_xp_grant
  FOR EACH ROW EXECUTE FUNCTION public.fn_arena_xp_grant_immutable();

CREATE TABLE IF NOT EXISTS public.tb_arena_progression (
  id_user      UUID          PRIMARY KEY REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  xp_total     INTEGER       NOT NULL DEFAULT 0,
  grants       INTEGER       NOT NULL DEFAULT 0,
  revision     INTEGER       NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT chk_arena_progression CHECK (xp_total >= 0 AND grants >= 0 AND revision >= 0)
);
