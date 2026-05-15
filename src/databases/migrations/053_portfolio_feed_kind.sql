-- =============================================================================
-- Migration 053: Feed kind no item de portfólio (Feed vs Bees)
-- =============================================================================
-- Cada item de portfólio agora pertence a um dos dois feeds:
--   'feed' → posts 4:5 (imagem/vídeo) — vão para /feed (PortfolioFeed clássico).
--   'bees' → vídeos 9:16 — vão para /bees (feed vertical estilo TikTok).
-- A coluna é denormalizada no item para evitar JOIN em mídia em todo ranking.
-- Backfill: itens existentes cuja primeira mídia ativa é um vídeo com
-- aspect ratio (w/h) <= 0.6 são marcados como 'bees'; o resto permanece 'feed'.
-- =============================================================================

ALTER TABLE public.tb_profile_portfolio_item
  ADD COLUMN IF NOT EXISTS feed_kind VARCHAR(10) NOT NULL DEFAULT 'feed';

ALTER TABLE public.tb_profile_portfolio_item
  DROP CONSTRAINT IF EXISTS tb_profile_portfolio_item_feed_kind_chk;

ALTER TABLE public.tb_profile_portfolio_item
  ADD CONSTRAINT tb_profile_portfolio_item_feed_kind_chk
  CHECK (feed_kind IN ('feed','bees'));

-- Backfill: classifica como 'bees' itens cuja primeira mídia ativa é vídeo 9:16
-- (ratio = width/height <= 0.6 cobre 9:16 = 0.5625 com folga).
UPDATE public.tb_profile_portfolio_item ppi
   SET feed_kind = 'bees'
  FROM (
    SELECT DISTINCT ON (m.id_portfolio_item)
      m.id_portfolio_item,
      m.media_type,
      m.width,
      m.height
    FROM public.tb_profile_portfolio_media m
    WHERE m.is_active = TRUE
    ORDER BY m.id_portfolio_item, m.sort_order, m.created_at
  ) first_media
 WHERE first_media.id_portfolio_item = ppi.id_portfolio_item
   AND first_media.media_type = 'video'
   AND first_media.width  IS NOT NULL
   AND first_media.height IS NOT NULL
   AND first_media.height > 0
   AND (first_media.width::NUMERIC / first_media.height) <= 0.6;

-- Índices que suportam os rankings filtrados por feed.
CREATE INDEX IF NOT EXISTS idx_portfolio_item_bees_score
  ON public.tb_profile_portfolio_item (engagement_score DESC, published_at DESC)
  WHERE status = 'published' AND is_active = TRUE AND feed_kind = 'bees';

CREATE INDEX IF NOT EXISTS idx_portfolio_item_bees_recent
  ON public.tb_profile_portfolio_item (published_at DESC)
  WHERE status = 'published' AND is_active = TRUE AND feed_kind = 'bees';

CREATE INDEX IF NOT EXISTS idx_portfolio_item_feed_kind_recent
  ON public.tb_profile_portfolio_item (published_at DESC)
  WHERE status = 'published' AND is_active = TRUE AND feed_kind = 'feed';
