-- =============================================================================
-- Migration 289: Freelandoo Arena — resultado de minigame (Jetpack Race, M14)
-- =============================================================================
-- A corrida roda no servidor de jogo, que é a AUTORIDADE do resultado (chegada
-- detectada lá, por tick + fração). O backend só GUARDA o que ela atestou, de
-- forma idempotente, e transforma quem cruzou a chegada num fato do M12.
--
--   tb_arena_minigame_match   — uma linha por partida concluída. result_id é a
--                               chave de idempotência (o servidor reenvia com o
--                               mesmo id até ter resposta). match_id também é
--                               único: uma partida não tem dois resultados.
--                               payload_hash = sha256 do resultado canônico —
--                               mesmo id com conteúdo diferente é CONFLITO (409),
--                               nunca "atualização".
--   tb_arena_minigame_result  — colocação de cada participante. DNF não tem
--                               tempo nem colocação; empate = mesma colocação.
--
-- Fato novo `race_finished`: SÓ quem cruzou a chegada, inserido na MESMA
-- transação do resultado (outbox do M12). Entrar no lobby, abortar ou DNF não
-- premia. Os dois CHECKs de tipo de fato (tb_arena_fact e tb_arena_mission_def)
-- são reescritos como SUPERSET com o MESMO nome de constraint.
--
-- Recuperação:
--   DROP TABLE public.tb_arena_minigame_result, public.tb_arena_minigame_match CASCADE;
--   (os CHECKs aceitando race_finished podem ficar: são superset)
--   DELETE FROM public.schema_migrations WHERE filename = '289_arena_minigames.sql';
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_arena_minigame_match (
  result_id           UUID          PRIMARY KEY,
  match_id            VARCHAR(64)   NOT NULL,
  experience_id       VARCHAR(48)   NOT NULL,
  experience_version  INTEGER       NOT NULL,
  rules_version       INTEGER       NOT NULL,
  environment_id      VARCHAR(48)   NOT NULL,
  portal_id           VARCHAR(64)   NOT NULL,
  track_seed          BIGINT        NOT NULL,
  track_version       INTEGER       NOT NULL,
  track_hash          VARCHAR(64)   NOT NULL,
  -- Autoridade que atestou (processo + época do diretório, mig 288). Nulo com
  -- um processo só (sem diretório).
  worker_id           VARCHAR(64),
  worker_epoch        INTEGER,
  started_at          TIMESTAMPTZ   NOT NULL,
  finished_at         TIMESTAMPTZ   NOT NULL,
  participants        SMALLINT      NOT NULL,
  payload_hash        CHAR(64)      NOT NULL,
  recorded_at         TIMESTAMPTZ   NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT chk_arena_mg_experience CHECK (experience_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT chk_arena_mg_times CHECK (finished_at >= started_at),
  CONSTRAINT chk_arena_mg_participants CHECK (participants BETWEEN 1 AND 16)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_arena_mg_match ON public.tb_arena_minigame_match (match_id);
CREATE INDEX IF NOT EXISTS ix_arena_mg_recorded ON public.tb_arena_minigame_match (experience_id, recorded_at);

CREATE TABLE IF NOT EXISTS public.tb_arena_minigame_result (
  result_id   UUID          NOT NULL REFERENCES public.tb_arena_minigame_match(result_id) ON DELETE CASCADE,
  slot        SMALLINT      NOT NULL,
  id_user     UUID          NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  outcome     VARCHAR(12)   NOT NULL,
  place       SMALLINT,
  time_ms     INTEGER,
  PRIMARY KEY (result_id, slot),
  CONSTRAINT chk_arena_mg_outcome CHECK (outcome IN ('finished', 'dnf')),
  CONSTRAINT chk_arena_mg_shape CHECK (
    (outcome = 'finished' AND place >= 1 AND time_ms > 0)
    OR (outcome = 'dnf' AND place IS NULL AND time_ms IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_arena_mg_result_user ON public.tb_arena_minigame_result (result_id, id_user);
CREATE INDEX IF NOT EXISTS ix_arena_mg_result_user ON public.tb_arena_minigame_result (id_user);

-- Superset dos tipos de fato (mesmo nome de constraint: nada antigo fica valendo em paralelo).
ALTER TABLE public.tb_arena_fact DROP CONSTRAINT IF EXISTS chk_arena_fact_type;
ALTER TABLE public.tb_arena_fact ADD CONSTRAINT chk_arena_fact_type
  CHECK (fact_type IN ('checkpoint_accepted', 'post_visited', 'video_completed', 'race_finished'));

ALTER TABLE public.tb_arena_mission_def DROP CONSTRAINT IF EXISTS chk_arena_mission_fact;
ALTER TABLE public.tb_arena_mission_def ADD CONSTRAINT chk_arena_mission_fact
  CHECK (fact_type IN ('checkpoint_accepted', 'post_visited', 'video_completed', 'race_finished'));
