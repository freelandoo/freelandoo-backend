-- =============================================================================
-- Migration 081: Denúncia de posts (portfolio items) + soft-ban admin
-- =============================================================================
-- Permite que qualquer usuário denuncie um post de portfólio. Garante apenas
-- uma denúncia por (post, denunciante) via UNIQUE. Em tb_portfolio_item
-- mantemos report_count e top_report_reason desnormalizados pro admin filtrar
-- rápido. Soft-ban: is_banned=TRUE + banned_at + banned_by_user_id;
-- queries públicas devem filtrar AND is_banned = FALSE.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_post_report (
  id_post_report     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_portfolio_item  UUID         NOT NULL REFERENCES public.tb_profile_portfolio_item(id_portfolio_item) ON DELETE CASCADE,
  reporter_user_id   UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  reason_category    VARCHAR(32)  NOT NULL,
  reason             TEXT,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (id_portfolio_item, reporter_user_id)
);

CREATE INDEX IF NOT EXISTS idx_post_report_item
  ON public.tb_post_report (id_portfolio_item, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_post_report_reporter
  ON public.tb_post_report (reporter_user_id, created_at DESC);

ALTER TABLE public.tb_profile_portfolio_item
  ADD COLUMN IF NOT EXISTS report_count        INT          NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS top_report_reason   VARCHAR(32),
  ADD COLUMN IF NOT EXISTS is_banned           BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS banned_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS banned_by_user_id   UUID         REFERENCES public.tb_user(id_user);

CREATE INDEX IF NOT EXISTS idx_portfolio_item_reports
  ON public.tb_profile_portfolio_item (report_count DESC)
  WHERE report_count > 0;

CREATE INDEX IF NOT EXISTS idx_portfolio_item_banned
  ON public.tb_profile_portfolio_item (is_banned)
  WHERE is_banned = TRUE;
