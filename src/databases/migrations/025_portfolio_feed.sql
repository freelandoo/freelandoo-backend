-- =============================================================================
-- Migration 025: Feed de portfólios (/explorar)
-- =============================================================================
-- Adiciona status/published_at e contadores de engajamento por item de
-- portfólio, e cria a tabela de eventos do feed. Os contadores são atualizados
-- pela aplicação (no endpoint de eventos) e recalculados periodicamente, no
-- mesmo padrão do profile_ranking.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Status e published_at em itens de portfólio
-- Items pré-existentes recebem status='published' e published_at=created_at
-- para manter retrocompatibilidade com a vitrine atual.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tb_profile_portfolio_item
  ADD COLUMN IF NOT EXISTS status         VARCHAR(20)  NOT NULL DEFAULT 'published',
  ADD COLUMN IF NOT EXISTS published_at   TIMESTAMPTZ  NULL;

UPDATE public.tb_profile_portfolio_item
   SET published_at = created_at
 WHERE published_at IS NULL;

ALTER TABLE public.tb_profile_portfolio_item
  DROP CONSTRAINT IF EXISTS tb_profile_portfolio_item_status_chk;

ALTER TABLE public.tb_profile_portfolio_item
  ADD CONSTRAINT tb_profile_portfolio_item_status_chk
  CHECK (status IN ('draft','published','archived'));

-- ─────────────────────────────────────────────────────────────────────────────
-- Contadores agregados por item (mantidos pela aplicação)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tb_profile_portfolio_item
  ADD COLUMN IF NOT EXISTS likes_count            INT     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shares_count           INT     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS impressions_count      INT     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS profile_clicks_count   INT     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS whatsapp_clicks_count  INT     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS social_clicks_count    INT     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS engagement_score       NUMERIC NOT NULL DEFAULT 0;

-- Backfill de likes_count a partir de portfolio_likes existentes
UPDATE public.tb_profile_portfolio_item ppi
   SET likes_count = sub.cnt
  FROM (
    SELECT id_portfolio_item, COUNT(*)::INT AS cnt
      FROM public.portfolio_likes
     GROUP BY id_portfolio_item
  ) sub
 WHERE ppi.id_portfolio_item = sub.id_portfolio_item
   AND ppi.likes_count = 0;

-- Backfill do engagement_score com a fórmula base (apenas likes existem)
UPDATE public.tb_profile_portfolio_item
   SET engagement_score = likes_count * 1
 WHERE engagement_score = 0
   AND likes_count > 0;

-- Índices que suportam o ranking e o filtro do feed
CREATE INDEX IF NOT EXISTS idx_portfolio_item_feed_score
  ON public.tb_profile_portfolio_item (engagement_score DESC, published_at DESC)
  WHERE status = 'published' AND is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_portfolio_item_feed_recent
  ON public.tb_profile_portfolio_item (published_at DESC)
  WHERE status = 'published' AND is_active = TRUE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Eventos do feed
-- Visitante anônimo é identificado por session_id; usuário logado por id_user.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_portfolio_event (
  id                  BIGSERIAL    PRIMARY KEY,
  id_portfolio_item   UUID         NOT NULL REFERENCES public.tb_profile_portfolio_item(id_portfolio_item) ON DELETE CASCADE,
  id_profile          UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_user             UUID         NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  session_id          VARCHAR(64)  NULL,
  event_type          VARCHAR(30)  NOT NULL,
  machine_filter      INTEGER      NULL,
  profession_filter   INTEGER      NULL,
  city_filter         VARCHAR(120) NULL,
  state_filter        VARCHAR(2)   NULL,
  metadata            JSONB        NULL,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT tb_portfolio_event_type_chk
    CHECK (event_type IN (
      'impression','like','unlike','share','profile_click',
      'whatsapp_click','social_click','view_more_caption'
    ))
);

CREATE INDEX IF NOT EXISTS idx_portfolio_event_item_date
  ON public.tb_portfolio_event (id_portfolio_item, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_portfolio_event_session_item
  ON public.tb_portfolio_event (session_id, id_portfolio_item, event_type)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_portfolio_event_type_date
  ON public.tb_portfolio_event (event_type, created_at DESC);
