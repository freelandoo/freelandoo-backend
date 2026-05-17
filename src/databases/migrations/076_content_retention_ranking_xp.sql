-- =============================================================================
-- Migration 076: Content retention + unified ranking/XP metric
-- =============================================================================
-- XP is the source metric. Ranking uses the same XP events filtered by period;
-- profile level keeps using the all-time XP total.

ALTER TABLE public.xp_settings
  ADD COLUMN IF NOT EXISTS content_retention_second_xp NUMERIC NOT NULL DEFAULT 0.05;

ALTER TABLE public.profile_ranking
  ADD COLUMN IF NOT EXISTS content_retention_seconds INT NOT NULL DEFAULT 0;

ALTER TABLE public.tb_portfolio_event
  DROP CONSTRAINT IF EXISTS tb_portfolio_event_type_chk;

ALTER TABLE public.tb_portfolio_event
  ADD CONSTRAINT tb_portfolio_event_type_chk
  CHECK (event_type IN (
    'impression','like','unlike','share','profile_click',
    'whatsapp_click','social_click','view_more_caption','content_retention'
  ));

CREATE TABLE IF NOT EXISTS public.portfolio_content_retention (
  id BIGSERIAL PRIMARY KEY,
  id_portfolio_item UUID NOT NULL REFERENCES public.tb_profile_portfolio_item(id_portfolio_item) ON DELETE CASCADE,
  id_profile UUID NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_user UUID NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  session_id VARCHAR(64) NOT NULL,
  seconds_watched INT NOT NULL DEFAULT 0 CHECK (seconds_watched >= 0),
  last_sequence INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_portfolio_content_retention_session
  ON public.portfolio_content_retention (id_portfolio_item, session_id);

CREATE INDEX IF NOT EXISTS idx_portfolio_content_retention_profile
  ON public.portfolio_content_retention (id_profile, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_xp_events_profile_period
  ON public.subprofile_xp_events (id_profile, created_at DESC, xp_amount);

COMMENT ON COLUMN public.xp_settings.content_retention_second_xp IS
  'XP granted for each valid second watched/stayed on portfolio feed content.';

COMMENT ON COLUMN public.profile_ranking.total_points IS
  'Windowed sum of subprofile_xp_events.xp_amount for the configured ranking period.';

COMMENT ON COLUMN public.profile_ranking.content_retention_seconds IS
  'Watched/stayed seconds inside the configured ranking period.';
