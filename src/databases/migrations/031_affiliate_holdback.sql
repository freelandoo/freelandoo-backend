-- Migration 031: Affiliate holdback period
--
-- Comissão continua sendo paga 30 dias após a venda (approval_delay_days),
-- mas no painel do afiliado ela só aparece como "aprovada" depois de 8 dias —
-- janela em que o assinante ainda pode solicitar reembolso (CDC, Brasil).
--
-- Idempotente.

-- =============================================================================
-- tb_affiliate_settings.holdback_days — janela de "aguardando reembolso"
-- =============================================================================
ALTER TABLE public.tb_affiliate_settings
  ADD COLUMN IF NOT EXISTS holdback_days INTEGER NOT NULL DEFAULT 8;

-- =============================================================================
-- tb_affiliate_coupon_override.holdback_days — override por cupom (nullable)
-- =============================================================================
ALTER TABLE public.tb_affiliate_coupon_override
  ADD COLUMN IF NOT EXISTS holdback_days INTEGER;

-- =============================================================================
-- tb_affiliate_conversion.holdback_until — calculado quando vai pra APPROVED
-- =============================================================================
ALTER TABLE public.tb_affiliate_conversion
  ADD COLUMN IF NOT EXISTS holdback_until TIMESTAMPTZ;

-- Backfill: conversões já APPROVED há mais de 8 dias são consideradas
-- fora da janela (holdback_until = approved_at + 8d). As mais novas seguem a
-- mesma fórmula, então o painel já mostra coerentemente.
UPDATE public.tb_affiliate_conversion
SET holdback_until = approved_at + INTERVAL '8 days'
WHERE holdback_until IS NULL
  AND approved_at IS NOT NULL;
