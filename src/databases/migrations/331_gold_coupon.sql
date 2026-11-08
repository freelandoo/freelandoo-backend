-- =============================================================================
-- Migration 331 — A7: cupom de desconto comprado com Gold
-- =============================================================================
-- 12 Gold a cada R$ 10 de desconto (emerald_settings.coupon_gold_per_10_brl):
-- cobre o bônus dos pacotes + a tarifa do Mercado Pago. Nunca com Esmeralda.
--
-- O cupom é uma linha de tb_coupon (mesmo código único, mesma busca do
-- admin), mas com DONO GOLD em vez de dono afiliado:
--   * owner_user_id fica NULL → nenhum caminho de afiliado paga comissão;
--   * gold_owner_user_id = quem comprou → só ele usa;
--   * discount_type 'amount', value em centavos, max_uses 1;
--   * reserved_* = preso a UMA cobrança aberta (3 h); redeemed_* = usado.
-- Os caminhos antigos de cupom por código (ativação de perfil, checkout
-- legado, validação pública) não enxergam cupom Gold: ele entra só pelo
-- seletor da compra (gold_coupon_id), que reserva e resgata.
-- =============================================================================

ALTER TABLE public.tb_coupon ADD COLUMN IF NOT EXISTS gold_owner_user_id UUID REFERENCES public.tb_user(id_user);
ALTER TABLE public.tb_coupon ADD COLUMN IF NOT EXISTS gold_spent INTEGER;
ALTER TABLE public.tb_coupon ADD COLUMN IF NOT EXISTS reserved_until TIMESTAMPTZ;
ALTER TABLE public.tb_coupon ADD COLUMN IF NOT EXISTS reserved_ref TEXT;
ALTER TABLE public.tb_coupon ADD COLUMN IF NOT EXISTS redeemed_at TIMESTAMPTZ;
ALTER TABLE public.tb_coupon ADD COLUMN IF NOT EXISTS redeemed_ref TEXT;

ALTER TABLE public.tb_coupon DROP CONSTRAINT IF EXISTS tb_coupon_gold_shape_chk;
ALTER TABLE public.tb_coupon
  ADD CONSTRAINT tb_coupon_gold_shape_chk CHECK (
    gold_owner_user_id IS NULL
    OR (owner_user_id IS NULL AND discount_type = 'amount' AND gold_spent > 0)
  );

CREATE INDEX IF NOT EXISTS ix_tb_coupon_gold_owner
  ON public.tb_coupon (gold_owner_user_id, created_at DESC)
  WHERE gold_owner_user_id IS NOT NULL;
