-- =============================================================================
-- Migration 118: Painel de Arquitetura (admin)
-- =============================================================================
-- Dá ao admin um "mapa" vivo do app: cada função/feature do sistema (rota,
-- página, componente, botão, service, job) com seu status (live / órfão / wip /
-- deprecated), carimbo de git (commitado/pushado) e logs de rota para caçar
-- erros e gerenciar o funcionamento.
--
-- Duas tabelas:
--   arch_functions   — inventário (semeado por scan automático + curadoria admin)
--   arch_route_logs  — log de requisições/erros das rotas (alimentado por middleware)
--
-- O inventário é HÍBRIDO: linhas com source='auto' vêm do scan (scripts/arch-scan.js,
-- carimbado com git no deploy); o admin sobrepõe curated_status / notes / is_archived
-- sem que o próximo sync as sobrescreva.
--
-- Idempotente: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS + índices IF NOT EXISTS.
-- =============================================================================

-- ---------- Inventário de funções ----------
CREATE TABLE IF NOT EXISTS public.arch_functions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fn_key            TEXT NOT NULL UNIQUE,          -- slug estável (ex: "frontend:component:PolensCard")
  title             TEXT NOT NULL,
  description       TEXT,
  area              TEXT,                          -- feature/módulo (ex: "Poléns", "Stories", "Manifestação")
  kind              TEXT NOT NULL DEFAULT 'component',
  repo              TEXT NOT NULL DEFAULT 'frontend',
  file_path         TEXT,                          -- caminho relativo do arquivo de origem
  mount_path        TEXT,                          -- onde está montado/roteado; NULL = órfão
  -- Status efetivo do scan automático (heurística). O admin pode sobrepor via curated_status.
  status            TEXT NOT NULL DEFAULT 'live',  -- live | orphan | wip | deprecated
  curated_status    TEXT,                          -- override manual do admin (vence sobre status)
  -- Carimbo de git (do scan no deploy; produção não enxerga git em runtime).
  git_committed     BOOLEAN NOT NULL DEFAULT FALSE,
  git_pushed        BOOLEAN NOT NULL DEFAULT FALSE,
  last_commit_sha   TEXT,
  last_commit_msg   TEXT,
  last_commit_at    TIMESTAMPTZ,
  -- Origem da linha e curadoria.
  source            TEXT NOT NULL DEFAULT 'auto',  -- auto | curated
  is_archived       BOOLEAN NOT NULL DEFAULT FALSE,
  notes             TEXT,
  tags              TEXT[] NOT NULL DEFAULT '{}',
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced_at    TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  curated_by        UUID REFERENCES public.tb_user(id_user),
  CONSTRAINT arch_functions_kind_chk
    CHECK (kind IN ('route','page','component','button','service','job','proxy','hook','other')),
  CONSTRAINT arch_functions_repo_chk
    CHECK (repo IN ('frontend','backend','shared')),
  CONSTRAINT arch_functions_status_chk
    CHECK (status IN ('live','orphan','wip','deprecated')),
  CONSTRAINT arch_functions_curated_status_chk
    CHECK (curated_status IS NULL OR curated_status IN ('live','orphan','wip','deprecated')),
  CONSTRAINT arch_functions_source_chk
    CHECK (source IN ('auto','curated'))
);

CREATE INDEX IF NOT EXISTS ix_arch_functions_status
  ON public.arch_functions (status);
CREATE INDEX IF NOT EXISTS ix_arch_functions_area
  ON public.arch_functions (area);
CREATE INDEX IF NOT EXISTS ix_arch_functions_repo_kind
  ON public.arch_functions (repo, kind);
CREATE INDEX IF NOT EXISTS ix_arch_functions_archived
  ON public.arch_functions (is_archived);

-- ---------- Log de rotas ----------
CREATE TABLE IF NOT EXISTS public.arch_route_logs (
  id              BIGSERIAL PRIMARY KEY,
  request_id      TEXT,
  method          TEXT NOT NULL,
  path            TEXT NOT NULL,                   -- originalUrl sem querystring
  route_pattern   TEXT,                            -- baseUrl + route.path (best-effort)
  status_code     INTEGER NOT NULL,
  duration_ms     INTEGER,
  user_id         UUID,
  ip              TEXT,
  error_message   TEXT,
  error_stack     TEXT,
  meta            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_arch_route_logs_created
  ON public.arch_route_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS ix_arch_route_logs_status
  ON public.arch_route_logs (status_code, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_arch_route_logs_path
  ON public.arch_route_logs (path text_pattern_ops);
-- Acelera o filtro "só erros" (>= 400) que é o uso principal do painel.
CREATE INDEX IF NOT EXISTS ix_arch_route_logs_errors
  ON public.arch_route_logs (created_at DESC)
  WHERE status_code >= 400;
