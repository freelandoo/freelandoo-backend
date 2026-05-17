-- =============================================================================
-- Migration 073: Store Governance — taxas de serviço + maquininha
-- =============================================================================
-- Singleton de configuração da plataforma. Vendedor digita preço que quer
-- receber (price_amount); vitrine soma service_fee + processor_fee_estimated
-- e mostra como "display_price". Stripe cobra o display_price; após webhook
-- charge.succeeded, a fee real (balance_transaction.fee) substitui o estimado.
--
-- Modelo: comprador paga as taxas (gross-up). Vendedor recebe exatamente o
-- price_amount cravado.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_store_governance_settings (
  id_settings                          INT          PRIMARY KEY DEFAULT 1
                                         CHECK (id_settings = 1),
  service_fee_percent                  NUMERIC(5,3) NOT NULL DEFAULT 5.000
                                         CHECK (service_fee_percent >= 0 AND service_fee_percent < 100),
  service_fee_fixed_cents              INT          NOT NULL DEFAULT 0
                                         CHECK (service_fee_fixed_cents >= 0),
  service_fee_min_cents                INT          CHECK (service_fee_min_cents IS NULL OR service_fee_min_cents >= 0),
  service_fee_max_cents                INT          CHECK (service_fee_max_cents IS NULL OR service_fee_max_cents >= 0),
  processor_fee_mode                   VARCHAR(16)  NOT NULL DEFAULT 'auto_stripe'
                                         CHECK (processor_fee_mode IN ('auto_stripe','manual')),
  processor_fee_percent_fallback       NUMERIC(5,3) NOT NULL DEFAULT 3.990
                                         CHECK (processor_fee_percent_fallback >= 0 AND processor_fee_percent_fallback < 100),
  processor_fee_fixed_cents_fallback   INT          NOT NULL DEFAULT 39
                                         CHECK (processor_fee_fixed_cents_fallback >= 0),
  updated_by_user_id                   UUID         REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  created_at                           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at                           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Seed do singleton com valores Stripe BR cartão (3,99% + R$ 0,39) e
-- taxa de serviço inicial de 5%.
INSERT INTO public.tb_store_governance_settings (id_settings)
VALUES (1)
ON CONFLICT (id_settings) DO NOTHING;
