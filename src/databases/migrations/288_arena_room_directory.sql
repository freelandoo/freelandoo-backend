-- =============================================================================
-- Migration 288: Freelandoo Arena — diretório de salas entre servidores de jogo
-- =============================================================================
-- Com UM processo de jogo, salas, controle único e retomada vivem na memória
-- dele (Maps). Com DOIS ou mais, essa memória não coordena nada: a mesma
-- "Sala 1" existiria em cada processo e a mesma conta poderia controlar um
-- avatar em cada um. Este diretório é a coordenação mínima, no Postgres que já
-- existe (sem Redis):
--
--   tb_arena_worker          processos de jogo registrados. `epoch` muda a cada
--                            boot (geração): um processo antigo que volte de uma
--                            pausa é reconhecido como AUTORIDADE VENCIDA
--                            (fencing) e larga as salas. `lease_until` é a vida:
--                            sem batida dentro do prazo, o processo deixa de
--                            receber admissões e as salas dele saem do diretório.
--   tb_arena_room            UMA linha por (ambiente, sala) = UMA autoridade. A
--                            chave primária é a garantia: duas admissões
--                            simultâneas nunca criam a mesma sala em dois
--                            processos. A ocupação é a que o dono reporta.
--   tb_arena_admission       ticket de admissão: conta + ambiente + sala +
--                            processo + época, prazo curto e USO ÚNICO. Só o
--                            HASH do ticket é guardado. Ticket ainda não usado
--                            conta como vaga reservada (sem overbooking).
--   tb_arena_account_lease   em qual processo a CONTA está agora. Admissão nova
--                            da mesma conta vai para ESSE processo (lá o controle
--                            único, o "Jogar aqui" e a retomada já funcionam).
--                            Mudar de processo exige o dono largar a conta
--                            (revoke_requested_at → próxima batida) ou o prazo
--                            vencer — nunca dois controladores válidos.
--
-- Movimento NÃO passa por aqui: posições ficam na memória do processo. A
-- escrita é por batida (segundos), nunca por tick.
--
-- Rollback:
--   DROP TABLE public.tb_arena_account_lease, public.tb_arena_admission,
--              public.tb_arena_room, public.tb_arena_worker;
--   DELETE FROM public.schema_migrations WHERE filename = '288_arena_room_directory.sql';

CREATE TABLE IF NOT EXISTS public.tb_arena_worker (
  worker_id         VARCHAR(64)  PRIMARY KEY,
  epoch             BIGINT       NOT NULL DEFAULT 1,
  -- Base pública (https) do processo. Registrada pelo próprio processo pelo
  -- canal assinado; é o ÚNICO lugar de onde o navegador recebe endereço.
  endpoint          VARCHAR(300) NOT NULL,
  protocol_version  INT          NOT NULL,
  state             VARCHAR(16)  NOT NULL DEFAULT 'available',
  max_players       INT          NOT NULL,
  max_rooms         INT          NOT NULL,
  room_capacity     INT          NOT NULL,
  players           INT          NOT NULL DEFAULT 0,
  rooms             INT          NOT NULL DEFAULT 0,
  registered_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  heartbeat_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  lease_until       TIMESTAMPTZ  NOT NULL,
  CONSTRAINT chk_arena_worker_id CHECK (worker_id ~ '^[A-Za-z0-9._-]{1,64}$'),
  CONSTRAINT chk_arena_worker_state CHECK (state IN ('available', 'draining', 'unavailable')),
  CONSTRAINT chk_arena_worker_caps CHECK (max_players > 0 AND max_rooms > 0 AND room_capacity > 0 AND players >= 0 AND rooms >= 0)
);

CREATE TABLE IF NOT EXISTS public.tb_arena_room (
  environment_id    VARCHAR(16)  NOT NULL,
  shard             INT          NOT NULL,
  worker_id         VARCHAR(64)  NOT NULL REFERENCES public.tb_arena_worker(worker_id) ON DELETE CASCADE,
  worker_epoch      BIGINT       NOT NULL,
  capacity          INT          NOT NULL,
  occupancy         INT          NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  reported_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (environment_id, shard),
  CONSTRAINT chk_arena_room_env CHECK (environment_id ~ '^br-[a-z]{2}$'),
  CONSTRAINT chk_arena_room_nums CHECK (shard >= 0 AND shard <= 10000 AND capacity > 0 AND occupancy >= 0)
);
CREATE INDEX IF NOT EXISTS idx_arena_room_worker ON public.tb_arena_room (worker_id, worker_epoch);

CREATE TABLE IF NOT EXISTS public.tb_arena_admission (
  id_admission      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_hash       BYTEA        NOT NULL UNIQUE,
  id_user           UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  environment_id    VARCHAR(16)  NOT NULL,
  shard             INT          NOT NULL,
  worker_id         VARCHAR(64)  NOT NULL,
  worker_epoch      BIGINT       NOT NULL,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMPTZ  NOT NULL,
  consumed_at       TIMESTAMPTZ
);
-- Reservas vivas por sala (o que entra na conta da vaga).
CREATE INDEX IF NOT EXISTS idx_arena_admission_pending
  ON public.tb_arena_admission (environment_id, shard)
  WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_arena_admission_expires ON public.tb_arena_admission (expires_at);

CREATE TABLE IF NOT EXISTS public.tb_arena_account_lease (
  id_user              UUID         PRIMARY KEY REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  worker_id            VARCHAR(64)  NOT NULL,
  worker_epoch         BIGINT       NOT NULL,
  environment_id       VARCHAR(16)  NOT NULL,
  shard                INT          NOT NULL,
  lease_until          TIMESTAMPTZ  NOT NULL,
  revoke_requested_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_arena_account_lease_worker ON public.tb_arena_account_lease (worker_id, worker_epoch);
