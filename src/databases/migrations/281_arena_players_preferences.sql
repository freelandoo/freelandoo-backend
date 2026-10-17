-- =============================================================================
-- Migration 281: Freelandoo Arena — jogador, catálogo de comunidades,
-- preferências e consentimento específico (Módulos 04 e 05 da Arena)
-- =============================================================================
-- Primeiras tabelas da Arena (ADR-0005 do repositório freelandoo-arena: prefixo
-- tb_arena_*, MESMO runner, IDs da Freelandoo referenciados e nunca copiados).
--
-- tb_arena_player       — uma linha por conta (PK = id_user). O playerId é
--                         público e opaco; o id_user nunca sai do servidor.
--                         Não guarda nome, e-mail, CPF nem nascimento: o nome
--                         exibido é lido de tb_user na hora.
-- tb_arena_category     — categorias de disputa (política, anime, futebol,
--                         música, séries). NÃO são as categorias profissionais
--                         (tb_category) nem comunidades sociais (tb_profile).
-- tb_arena_team         — equipes de cada categoria. `is_synthetic` marca
--                         fixture de teste: o servidor nunca a mostra em
--                         produção.
-- tb_arena_preference   — no máximo UMA equipe por (jogador, categoria).
-- tb_arena_sensitive_consent — autorização específica para categoria sensível
--                         (opinião política). Guarda versão da política,
--                         concessão e revogação — NUNCA a equipe escolhida.
--
-- A seleção ativa é uma COLUNA do jogador (active_category_id) com FK composta
-- para a própria preferência: a equipe ativa é a equipe daquela preferência.
-- Não existe "categoria ativa sem equipe" nem "equipe ativa sem categoria" —
-- por construção. Apagar a preferência zera só a coluna (ON DELETE SET NULL
-- com lista de colunas, PostgreSQL 15+; produção roda 18).
--
-- Rollback (nenhum dado de outra feature depende disto):
--   DROP TABLE public.tb_arena_sensitive_consent, public.tb_arena_preference,
--              public.tb_arena_team, public.tb_arena_category,
--              public.tb_arena_player CASCADE;
--   DELETE FROM public.schema_migrations WHERE filename = '281_arena_players_preferences.sql';
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_arena_player (
  id_user            UUID         PRIMARY KEY REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  player_id          VARCHAR(35)  NOT NULL,
  active_category_id VARCHAR(32),
  revision           INTEGER      NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_arena_player_id_format CHECK (player_id ~ '^pl_[A-Za-z0-9]{10,32}$'),
  CONSTRAINT chk_arena_player_revision CHECK (revision >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_arena_player_player_id
  ON public.tb_arena_player (player_id);

CREATE TABLE IF NOT EXISTS public.tb_arena_category (
  category_id            VARCHAR(32)  PRIMARY KEY,
  is_sensitive           BOOLEAN      NOT NULL DEFAULT FALSE,
  is_active              BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order             INTEGER      NOT NULL DEFAULT 0,
  labels                 JSONB        NOT NULL,
  color                  VARCHAR(7),
  -- Versão da política que autoriza coletar esta categoria. NULL numa
  -- categoria sensível = coleta DESLIGADA (política não aprovada).
  consent_policy_version INTEGER,
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_arena_category_id CHECK (category_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(category_id) >= 2),
  CONSTRAINT chk_arena_category_labels CHECK (jsonb_typeof(labels) = 'object' AND labels ? 'pt-BR'),
  CONSTRAINT chk_arena_category_color CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT chk_arena_category_policy CHECK (consent_policy_version IS NULL OR consent_policy_version > 0)
);

CREATE TABLE IF NOT EXISTS public.tb_arena_team (
  category_id  VARCHAR(32)  NOT NULL REFERENCES public.tb_arena_category(category_id) ON DELETE CASCADE,
  team_id      VARCHAR(64)  NOT NULL,
  labels       JSONB        NOT NULL,
  color        VARCHAR(7),
  is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
  is_synthetic BOOLEAN      NOT NULL DEFAULT FALSE,
  sort_order   INTEGER      NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (category_id, team_id),
  CONSTRAINT chk_arena_team_id CHECK (team_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(team_id) >= 2),
  CONSTRAINT chk_arena_team_labels CHECK (jsonb_typeof(labels) = 'object' AND labels ? 'pt-BR'),
  CONSTRAINT chk_arena_team_color CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$')
);

CREATE TABLE IF NOT EXISTS public.tb_arena_preference (
  id_user     UUID         NOT NULL REFERENCES public.tb_arena_player(id_user) ON DELETE CASCADE,
  category_id VARCHAR(32)  NOT NULL,
  team_id     VARCHAR(64)  NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_user, category_id),
  -- A equipe TEM que ser daquela categoria: integridade no banco, não só no código.
  CONSTRAINT fk_arena_preference_team FOREIGN KEY (category_id, team_id)
    REFERENCES public.tb_arena_team(category_id, team_id) ON DELETE CASCADE
);

-- Consultas do catálogo ("quem escolheu esta equipe") ficam para os agregados
-- dos módulos 07/08; o índice já serve a integridade em DELETE de equipe.
CREATE INDEX IF NOT EXISTS ix_arena_preference_team
  ON public.tb_arena_preference (category_id, team_id);

-- Seleção ativa → preferência do PRÓPRIO jogador. Criada depois das duas
-- tabelas (referência circular). DROP antes do ADD = idempotente.
ALTER TABLE public.tb_arena_player
  DROP CONSTRAINT IF EXISTS fk_arena_player_active_preference;
ALTER TABLE public.tb_arena_player
  ADD CONSTRAINT fk_arena_player_active_preference
  FOREIGN KEY (id_user, active_category_id)
  REFERENCES public.tb_arena_preference(id_user, category_id)
  ON DELETE SET NULL (active_category_id);

CREATE TABLE IF NOT EXISTS public.tb_arena_sensitive_consent (
  id_user        UUID         NOT NULL REFERENCES public.tb_arena_player(id_user) ON DELETE CASCADE,
  category_id    VARCHAR(32)  NOT NULL REFERENCES public.tb_arena_category(category_id) ON DELETE CASCADE,
  policy_version INTEGER      NOT NULL,
  granted_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  revoked_at     TIMESTAMPTZ,
  PRIMARY KEY (id_user, category_id),
  CONSTRAINT chk_arena_consent_version CHECK (policy_version > 0)
);
