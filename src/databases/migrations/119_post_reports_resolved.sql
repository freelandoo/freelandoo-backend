-- =============================================================================
-- Migration 119: "Resolvido" para posts denunciados (alerta admin)
-- =============================================================================
-- Marca uma denúncia como tratada pelo admin SEM banir o post: ele continua no
-- ar, mas sai do modal de alerta ("posts denunciados pendentes") que aparece no
-- login do admin. Reabre automaticamente quando chega uma denúncia NOVA — o
-- service zera reports_resolved_at no insert de uma denúncia inédita.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS + índice parcial IF NOT EXISTS.
-- =============================================================================

ALTER TABLE public.tb_profile_portfolio_item
  ADD COLUMN IF NOT EXISTS reports_resolved_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reports_resolved_by_user_id UUID REFERENCES public.tb_user(id_user);

-- Acelera o alerta: posts com denúncia, não banidos e ainda não resolvidos.
CREATE INDEX IF NOT EXISTS idx_portfolio_item_reports_pending
  ON public.tb_profile_portfolio_item (report_count DESC)
  WHERE report_count > 0 AND is_banned = FALSE AND reports_resolved_at IS NULL;
