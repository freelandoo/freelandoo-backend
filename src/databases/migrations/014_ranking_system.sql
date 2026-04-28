-- =============================================================================
-- Migration 014: Sistema de ranking — visitas, likes, avaliações, tempo online
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Visitas ao perfil (visitante anônimo via IP ou autenticado via id_user)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profile_visits (
  id            BIGSERIAL    PRIMARY KEY,
  id_profile    UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_user       UUID         NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  visitor_ip    VARCHAR(45)  NULL,
  visited_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profile_visits_profile_date
  ON public.profile_visits (id_profile, visited_at DESC);

-- Evita contagem duplicada do mesmo usuário autenticado no mesmo dia
CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_visits_user_daily
  ON public.profile_visits (id_profile, id_user, DATE(visited_at))
  WHERE id_user IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Likes em itens de portfólio
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.portfolio_likes (
  id                  BIGSERIAL    PRIMARY KEY,
  id_portfolio_item   UUID         NOT NULL REFERENCES public.tb_profile_portfolio_item(id_portfolio_item) ON DELETE CASCADE,
  id_profile          UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_user             UUID         NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  liked_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_likes_user_item
  ON public.portfolio_likes (id_portfolio_item, id_user)
  WHERE id_user IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_portfolio_likes_profile
  ON public.portfolio_likes (id_profile, liked_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- Avaliações do perfil (apenas usuários com assinatura ativa podem avaliar)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profile_ratings (
  id            BIGSERIAL    PRIMARY KEY,
  id_profile    UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_user       UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  rating        SMALLINT     NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment       TEXT         NULL,
  rated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (id_profile, id_user)
);

CREATE INDEX IF NOT EXISTS idx_profile_ratings_profile
  ON public.profile_ratings (id_profile, rated_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- Tempo online diário por usuário (batimentos de heartbeat)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_online_time (
  id              BIGSERIAL  PRIMARY KEY,
  id_user         UUID       NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  date            DATE       NOT NULL DEFAULT CURRENT_DATE,
  minutes_online  INT        NOT NULL DEFAULT 0 CHECK (minutes_online >= 0),
  UNIQUE (id_user, date)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Ranking calculado por perfil
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profile_ranking (
  id_profile          UUID     NOT NULL PRIMARY KEY REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  total_points        NUMERIC  NOT NULL DEFAULT 0,
  visits_count        INT      NOT NULL DEFAULT 0,
  likes_count         INT      NOT NULL DEFAULT 0,
  ratings_count       INT      NOT NULL DEFAULT 0,
  avg_rating          NUMERIC  NOT NULL DEFAULT 0,
  online_minutes      INT      NOT NULL DEFAULT 0,
  position_general    INT      NULL,
  position_machine    INT      NULL,
  position_city       INT      NULL,
  position_profession INT      NULL,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Configuração global do ranking (apenas uma linha — id = 1)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ranking_config (
  id                  INT        PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  is_enabled          BOOLEAN    NOT NULL DEFAULT TRUE,
  period_days         INT        NOT NULL DEFAULT 30,  -- 7, 30 ou 365
  weight_visits       NUMERIC    NOT NULL DEFAULT 1,
  weight_likes        NUMERIC    NOT NULL DEFAULT 2,
  weight_ratings      NUMERIC    NOT NULL DEFAULT 5,
  weight_online       NUMERIC    NOT NULL DEFAULT 0.5,
  max_online_minutes  INT        NOT NULL DEFAULT 120,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.ranking_config (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;
