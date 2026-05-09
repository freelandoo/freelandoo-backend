-- =============================================================================
-- Migration 035: Índice para filtro de nível na vitrine/feed
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_tb_profile_feed_xp_level
  ON public.tb_profile (xp_level DESC, id_profile)
  WHERE deleted_at IS NULL
    AND is_active = TRUE
    AND is_visible = TRUE;
