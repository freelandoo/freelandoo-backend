-- =============================================================================
-- Migration 101: Modo de entrega por produto
-- =============================================================================
-- Produto pode ser enviado por transportadora (default) ou apenas via retirada
-- no local com o vendedor. Quando 'local_pickup', o backend pula a cotação no
-- Melhor Envio e a UI direciona o comprador a falar com o vendedor.

ALTER TABLE public.tb_profile_product
  ADD COLUMN IF NOT EXISTS delivery_mode VARCHAR(20) NOT NULL DEFAULT 'shipping';

-- Constraint idempotente.
ALTER TABLE public.tb_profile_product
  DROP CONSTRAINT IF EXISTS tb_profile_product_delivery_mode_chk;

ALTER TABLE public.tb_profile_product
  ADD CONSTRAINT tb_profile_product_delivery_mode_chk
  CHECK (delivery_mode IN ('shipping', 'local_pickup'));

CREATE INDEX IF NOT EXISTS ix_profile_product_delivery_mode
  ON public.tb_profile_product (delivery_mode);

COMMENT ON COLUMN public.tb_profile_product.delivery_mode IS
  'shipping = cota via Melhor Envio; local_pickup = retirada combinada com o vendedor (sem frete).';
