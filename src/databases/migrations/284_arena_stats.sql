-- =============================================================================
-- Migration 284: Freelandoo Arena — estatísticas e mapas de calor (Módulo 08)
-- =============================================================================
-- Estatística é PROJEÇÃO das fontes canônicas, nunca uma segunda autoridade:
-- checkpoints saem de tb_arena_checkpoint (fatos), liderança da hora sai de
-- tb_arena_territory_tally (apuração do M07), liderança atual de
-- tb_arena_territory_state. Esta migration só acrescenta o que NÃO existia:
--
-- 1. Geometria histórica (prospectiva). tb_arena_post guarda só a posição ATUAL
--    do poste; desenhar fatos antigos sobre a posição de hoje seria falso se o
--    mapa mudou. Daqui em diante a apuração grava a posição/versão VIGENTE da
--    hora (post_x, post_y, map_version). Apuração anterior a esta migration
--    fica com NULL = "geometria histórica indisponível" — a API diz isso.
--
-- 2. Presença (não existia em lugar nenhum). O servidor de jogo, fora do tick,
--    manda a cada minuto quem está CONTROLANDO um avatar e quem está parado
--    aguardando retomada, com o trecho (32 m) onde está. Nada de trajetória:
--      tb_arena_presence_beat    — o minuto teve coleta (por instância): é a
--                                  COBERTURA. Minuto sem batida = sem dado,
--                                  nunca zero.
--      tb_arena_presence_sample  — CONTAGENS por minuto × ambiente × trecho.
--                                  Sem identidade.
--      tb_arena_presence_member  — quem foi visto controlando na HORA, só para
--                                  deduplicar únicos (abas, retomadas, shards,
--                                  instâncias). TRANSITÓRIO: apagado 48 h
--                                  depois; nunca sai em resposta pública.
--                                  ON DELETE CASCADE: conta excluída some daqui.
--      tb_arena_presence_unique  — únicos já consolidados por hora e por dia
--                                  (UTC), por ambiente e nacional ('*'). É a
--                                  marca d'água: bucket com linha = apurado.
--
-- Retenção: amostras 90 dias; membros 48 h; únicos e apurações sem prazo
-- (agregados, sem identidade).
--
-- Rollback:
--   DROP TABLE public.tb_arena_presence_unique, public.tb_arena_presence_member,
--              public.tb_arena_presence_sample, public.tb_arena_presence_beat;
--   ALTER TABLE public.tb_arena_territory_tally
--     DROP COLUMN post_x, DROP COLUMN post_y, DROP COLUMN map_version;
--   DELETE FROM public.schema_migrations WHERE filename = '284_arena_stats.sql';
-- Idempotente.
-- =============================================================================

ALTER TABLE public.tb_arena_territory_tally ADD COLUMN IF NOT EXISTS post_x NUMERIC(9,3);
ALTER TABLE public.tb_arena_territory_tally ADD COLUMN IF NOT EXISTS post_y NUMERIC(9,3);
ALTER TABLE public.tb_arena_territory_tally ADD COLUMN IF NOT EXISTS map_version INTEGER;

-- Leituras por período (ranking de vitórias, mapa de disputa).
CREATE INDEX IF NOT EXISTS ix_arena_tally_window
  ON public.tb_arena_territory_tally (window_start, environment_id);
-- Série de checkpoints por período (nacional e por ambiente).
CREATE INDEX IF NOT EXISTS ix_arena_checkpoint_window
  ON public.tb_arena_checkpoint (window_start, environment_id, category_id);

CREATE TABLE IF NOT EXISTS public.tb_arena_presence_beat (
  minute_at    TIMESTAMPTZ  NOT NULL,
  instance_id  VARCHAR(64)  NOT NULL,
  received_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (minute_at, instance_id),
  CONSTRAINT chk_arena_presence_beat_minute CHECK (date_trunc('minute', minute_at) = minute_at),
  CONSTRAINT chk_arena_presence_beat_instance CHECK (instance_id ~ '^[A-Za-z0-9._-]{1,64}$')
);

CREATE TABLE IF NOT EXISTS public.tb_arena_presence_sample (
  minute_at      TIMESTAMPTZ  NOT NULL,
  instance_id    VARCHAR(64)  NOT NULL,
  environment_id VARCHAR(48)  NOT NULL,
  chunk_index    INTEGER      NOT NULL,
  controlling    INTEGER      NOT NULL,
  away           INTEGER      NOT NULL,
  PRIMARY KEY (minute_at, instance_id, environment_id, chunk_index),
  CONSTRAINT chk_arena_presence_sample_env CHECK (environment_id ~ '^br-[a-z]{2}$'),
  CONSTRAINT chk_arena_presence_sample_counts CHECK (controlling >= 0 AND away >= 0),
  CONSTRAINT chk_arena_presence_sample_chunk CHECK (chunk_index BETWEEN 0 AND 100000)
);

CREATE INDEX IF NOT EXISTS ix_arena_presence_sample_env
  ON public.tb_arena_presence_sample (environment_id, minute_at);

CREATE TABLE IF NOT EXISTS public.tb_arena_presence_member (
  hour_start     TIMESTAMPTZ  NOT NULL,
  environment_id VARCHAR(48)  NOT NULL,
  id_user        UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  PRIMARY KEY (hour_start, environment_id, id_user),
  CONSTRAINT chk_arena_presence_member_hour CHECK (date_trunc('hour', hour_start AT TIME ZONE 'UTC') = hour_start AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS public.tb_arena_presence_unique (
  granularity    VARCHAR(4)   NOT NULL,
  bucket_start   TIMESTAMPTZ  NOT NULL,
  environment_id VARCHAR(48)  NOT NULL,
  unique_players INTEGER      NOT NULL,
  finalized_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (granularity, bucket_start, environment_id),
  CONSTRAINT chk_arena_presence_unique_gran CHECK (granularity IN ('hour', 'day')),
  CONSTRAINT chk_arena_presence_unique_env CHECK (environment_id = '*' OR environment_id ~ '^br-[a-z]{2}$'),
  CONSTRAINT chk_arena_presence_unique_n CHECK (unique_players >= 0)
);
