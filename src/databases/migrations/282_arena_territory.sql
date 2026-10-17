-- =============================================================================
-- Migration 282: Freelandoo Arena — postes de conquista, checkpoints por hora,
-- agregados territoriais e apuração horária (Módulo 07 da Arena)
-- =============================================================================
-- Fonte da verdade: tb_arena_checkpoint (fatos individuais aceitos). Os
-- agregados (tb_arena_territory_count / _state) são DERIVADOS e recomputáveis
-- a partir dela (ArenaTerritoryService.recompute). A apuração da hora fechada
-- vai para tb_arena_territory_tally, uma linha por disputa (idempotente).
--
-- tb_arena_post           — registro canônico dos postes por ambiente, gerado
--                           a partir do gerador do mundo (scripts/arena-posts.js).
--                           `competitive = FALSE` por padrão: poste registrado
--                           NÃO pontua até o proprietário ativar a regra.
--                           `valid_from` em hora cheia: mudança de mapa vale a
--                           partir da PRÓXIMA hora, nunca no meio de uma janela.
-- tb_arena_checkpoint     — uma participação aceita. Unicidade da regra V1
--                           (proposta): conta + ambiente + poste + categoria +
--                           janela. Equipe, shard, sessão e conexão NÃO entram
--                           na chave: trocar qualquer um não devolve o direito.
--                           A equipe gravada é a do instante da aceitação.
--                           id_user com ON DELETE SET NULL: excluir a conta
--                           anonimiza o fato sem desfazer o placar já apurado.
-- tb_arena_territory_count — contagem por equipe na janela.
-- tb_arena_territory_state — estado da disputa na janela (líder/empate/neutro),
--                           com `revision` de uma SEQUÊNCIA global: é o feed
--                           que o servidor de jogo usa para se recuperar de um
--                           broadcast perdido (equivalente a um outbox).
-- tb_arena_territory_tally — histórico da apuração horária.
--
-- Ordem de travas (evita deadlock): jogador (tb_arena_player FOR UPDATE, a
-- mesma das escritas do M05) → estado da disputa (FOR UPDATE). O finalizador só
-- trava o estado. Nenhum caminho trava na ordem inversa.
--
-- Rollback (nenhum dado de outra feature depende disto):
--   DROP TABLE public.tb_arena_territory_tally, public.tb_arena_territory_state,
--              public.tb_arena_territory_count, public.tb_arena_checkpoint,
--              public.tb_arena_post CASCADE;
--   DROP SEQUENCE public.seq_arena_territory_revision;
--   DELETE FROM public.schema_migrations WHERE filename = '282_arena_territory.sql';
-- Idempotente.
-- =============================================================================

CREATE SEQUENCE IF NOT EXISTS public.seq_arena_territory_revision;

CREATE TABLE IF NOT EXISTS public.tb_arena_post (
  environment_id    VARCHAR(48)   NOT NULL,
  post_id           VARCHAR(64)   NOT NULL,
  map_version       INTEGER       NOT NULL,
  generator_version INTEGER       NOT NULL,
  x                 NUMERIC(9,3)  NOT NULL,
  y                 NUMERIC(9,3)  NOT NULL,
  radius_m          NUMERIC(6,3)  NOT NULL,
  competitive       BOOLEAN       NOT NULL DEFAULT FALSE,
  is_active         BOOLEAN       NOT NULL DEFAULT TRUE,
  valid_from        TIMESTAMPTZ   NOT NULL,
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (environment_id, post_id),
  -- Laboratório (lab-*) nunca é ambiente competitivo: só br-<uf>.
  CONSTRAINT chk_arena_post_env CHECK (environment_id ~ '^br-[a-z]{2}$'),
  CONSTRAINT chk_arena_post_id CHECK (post_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT chk_arena_post_radius CHECK (radius_m > 0 AND radius_m <= 50),
  CONSTRAINT chk_arena_post_valid_hour CHECK (date_trunc('hour', valid_from AT TIME ZONE 'UTC') = valid_from AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS public.tb_arena_checkpoint (
  id_checkpoint  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user        UUID          REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  environment_id VARCHAR(48)   NOT NULL,
  post_id        VARCHAR(64)   NOT NULL,
  category_id    VARCHAR(32)   NOT NULL REFERENCES public.tb_arena_category(category_id),
  team_id        VARCHAR(64)   NOT NULL,
  window_start   TIMESTAMPTZ   NOT NULL,
  accepted_at    TIMESTAMPTZ   NOT NULL,
  request_id     UUID          NOT NULL,
  -- Hash do conteúdo da operação (ambiente, poste, janela pretendida,
  -- categoria esperada): reusar o requestId com outro conteúdo é recusado.
  request_hash   CHAR(64)      NOT NULL,
  rule_version   INTEGER       NOT NULL DEFAULT 1,
  CONSTRAINT fk_arena_checkpoint_post FOREIGN KEY (environment_id, post_id)
    REFERENCES public.tb_arena_post(environment_id, post_id),
  CONSTRAINT fk_arena_checkpoint_team FOREIGN KEY (category_id, team_id)
    REFERENCES public.tb_arena_team(category_id, team_id),
  CONSTRAINT chk_arena_checkpoint_window CHECK (
    accepted_at >= window_start AND accepted_at < window_start + INTERVAL '1 hour'
  )
);

-- A cota (regra V1 proposta): uma participação por conta+ambiente+poste+categoria+hora.
CREATE UNIQUE INDEX IF NOT EXISTS ux_arena_checkpoint_quota
  ON public.tb_arena_checkpoint (id_user, environment_id, post_id, category_id, window_start);
-- Idempotência da operação: o mesmo requestId do mesmo titular é UMA operação.
CREATE UNIQUE INDEX IF NOT EXISTS ux_arena_checkpoint_request
  ON public.tb_arena_checkpoint (id_user, request_id);
-- Recomputação e auditoria por disputa.
CREATE INDEX IF NOT EXISTS ix_arena_checkpoint_dispute
  ON public.tb_arena_checkpoint (environment_id, post_id, category_id, window_start, team_id);

CREATE TABLE IF NOT EXISTS public.tb_arena_territory_count (
  environment_id VARCHAR(48)  NOT NULL,
  post_id        VARCHAR(64)  NOT NULL,
  category_id    VARCHAR(32)  NOT NULL,
  window_start   TIMESTAMPTZ  NOT NULL,
  team_id        VARCHAR(64)  NOT NULL,
  count          INTEGER      NOT NULL,
  PRIMARY KEY (environment_id, post_id, category_id, window_start, team_id),
  CONSTRAINT chk_arena_territory_count CHECK (count >= 0)
);

CREATE TABLE IF NOT EXISTS public.tb_arena_territory_state (
  environment_id VARCHAR(48)  NOT NULL,
  post_id        VARCHAR(64)  NOT NULL,
  category_id    VARCHAR(32)  NOT NULL,
  window_start   TIMESTAMPTZ  NOT NULL,
  status         VARCHAR(8)   NOT NULL DEFAULT 'neutral',
  leader_team_id VARCHAR(64),
  total          INTEGER      NOT NULL DEFAULT 0,
  revision       BIGINT       NOT NULL DEFAULT nextval('public.seq_arena_territory_revision'),
  closed_at      TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (environment_id, post_id, category_id, window_start),
  CONSTRAINT chk_arena_territory_status CHECK (status IN ('neutral', 'leader', 'tie')),
  CONSTRAINT chk_arena_territory_leader CHECK ((status = 'leader') = (leader_team_id IS NOT NULL)),
  CONSTRAINT chk_arena_territory_total CHECK (total >= 0)
);

-- Feed de recuperação: o que mudou desde a revisão N, num ambiente.
CREATE INDEX IF NOT EXISTS ix_arena_territory_state_feed
  ON public.tb_arena_territory_state (environment_id, revision);
-- Finalizador: janelas ainda abertas.
CREATE INDEX IF NOT EXISTS ix_arena_territory_state_open
  ON public.tb_arena_territory_state (window_start) WHERE closed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.tb_arena_territory_tally (
  environment_id VARCHAR(48)  NOT NULL,
  post_id        VARCHAR(64)  NOT NULL,
  category_id    VARCHAR(32)  NOT NULL,
  window_start   TIMESTAMPTZ  NOT NULL,
  status         VARCHAR(8)   NOT NULL,
  leader_team_id VARCHAR(64),
  total          INTEGER      NOT NULL,
  counts         JSONB        NOT NULL,
  rule_version   INTEGER      NOT NULL,
  closed_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (environment_id, post_id, category_id, window_start),
  CONSTRAINT chk_arena_tally_status CHECK (status IN ('neutral', 'leader', 'tie')),
  CONSTRAINT chk_arena_tally_counts CHECK (jsonb_typeof(counts) = 'object')
);
