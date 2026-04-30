-- =============================================================================
-- Migration 019: Campos para cupom manual criado pelo admin
-- is_manual: true = criado pelo painel admin, sem afiliado
-- created_by_admin_id: id do admin que gerou (auditoria)
-- =============================================================================

ALTER TABLE public.tb_coupon
  ADD COLUMN IF NOT EXISTS is_manual          BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS created_by_admin_id UUID    REFERENCES public.tb_user(id_user);

CREATE INDEX IF NOT EXISTS ix_tb_coupon_manual
  ON public.tb_coupon (is_manual)
  WHERE is_manual = TRUE;
