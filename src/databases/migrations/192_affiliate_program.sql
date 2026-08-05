-- =============================================================================
-- Migration 192 — Programa de afiliados: % por produto + trilhos globais
-- =============================================================================
-- Slice P1 do desenho em docs/superpowers/specs/2026-08-05-afiliado-vitalicio-design.md
--
-- Acaba a % global única de afiliado (tb_affiliate_settings.default_commission_percent
-- usada para TUDO). Agora:
--
--   • o DONO do produto define quanto do próprio preço destina a afiliados
--     (tb_profile_product / tb_profile_service / courses . affiliate_percent);
--   • o ADMIN define os trilhos (teto, default, split) em tb_affiliate_program_settings;
--   • cada tipo de compra tem regra própria em tb_affiliate_commission_rule, incluindo
--     o REGIME ('platform' = plataforma vende → cria vínculo e dá desconto;
--     'user' = usuário vende → só comissão, e o cupom do conteúdo vence o vínculo).
--
-- Esta migration NÃO muda comportamento sozinha: enquanto affiliate_percent for NULL,
-- vale o default_percent (seedado com o valor legado). Idempotente.
-- =============================================================================

-- =============================================================================
-- 1. % de afiliado por item (NULL = usa o default global)
-- =============================================================================
ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS affiliate_percent NUMERIC(5,2);
ALTER TABLE public.tb_profile_product
  ADD COLUMN IF NOT EXISTS affiliate_percent NUMERIC(5,2);
ALTER TABLE public.tb_profile_service
  ADD COLUMN IF NOT EXISTS affiliate_percent NUMERIC(5,2);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'courses_affiliate_percent_chk') THEN
    ALTER TABLE public.courses ADD CONSTRAINT courses_affiliate_percent_chk
      CHECK (affiliate_percent IS NULL OR (affiliate_percent >= 0 AND affiliate_percent <= 100));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tb_profile_product_affiliate_percent_chk') THEN
    ALTER TABLE public.tb_profile_product ADD CONSTRAINT tb_profile_product_affiliate_percent_chk
      CHECK (affiliate_percent IS NULL OR (affiliate_percent >= 0 AND affiliate_percent <= 100));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tb_profile_service_affiliate_percent_chk') THEN
    ALTER TABLE public.tb_profile_service ADD CONSTRAINT tb_profile_service_affiliate_percent_chk
      CHECK (affiliate_percent IS NULL OR (affiliate_percent >= 0 AND affiliate_percent <= 100));
  END IF;
END $$;

COMMENT ON COLUMN public.tb_profile_product.affiliate_percent IS
  'Quanto do valor do vendedor vai para o programa de afiliados. NULL = default global. Só vale com affiliates_allowed = TRUE.';

-- =============================================================================
-- 2. tb_affiliate_program_settings — trilhos globais (versionado, última vence)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.tb_affiliate_program_settings (
  id_settings              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commission_split_percent NUMERIC(5,2) NOT NULL DEFAULT 70,
  seller_percent_min       NUMERIC(5,2) NOT NULL DEFAULT 0,
  seller_percent_max       NUMERIC(5,2) NOT NULL DEFAULT 50,
  default_percent          NUMERIC(5,2) NOT NULL DEFAULT 25,
  effective_from           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  notes                    TEXT,
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_by               UUID,
  CONSTRAINT tb_affiliate_program_settings_split_chk
    CHECK (commission_split_percent >= 0 AND commission_split_percent <= 100),
  CONSTRAINT tb_affiliate_program_settings_range_chk
    CHECK (seller_percent_min >= 0 AND seller_percent_max <= 100 AND seller_percent_min <= seller_percent_max),
  CONSTRAINT tb_affiliate_program_settings_default_chk
    CHECK (default_percent >= 0 AND default_percent <= 100)
);

CREATE INDEX IF NOT EXISTS ix_tb_affiliate_program_settings_effective
  ON public.tb_affiliate_program_settings (effective_from DESC);

COMMENT ON COLUMN public.tb_affiliate_program_settings.commission_split_percent IS
  'Do pool de afiliado, quanto vai para o afiliado. O resto vira desconto do vinculado — SÓ no regime plataforma.';

-- Seed: herda a % legada de tb_affiliate_settings quando ela existir, senão 25.
INSERT INTO public.tb_affiliate_program_settings
  (commission_split_percent, seller_percent_min, seller_percent_max, default_percent, notes)
SELECT
  70, 0, 50,
  COALESCE((
    SELECT default_commission_percent
    FROM public.tb_affiliate_settings
    ORDER BY effective_from DESC
    LIMIT 1
  ), 25),
  'Seed da mig 192. default_percent herdado da regra global antiga.'
WHERE NOT EXISTS (SELECT 1 FROM public.tb_affiliate_program_settings);

-- =============================================================================
-- 3. tb_affiliate_commission_rule — regra por tipo de compra
-- =============================================================================
-- regime:
--   'platform' → a plataforma vende. Cria vínculo vitalício e concede desconto.
--   'user'     → o usuário vende. Só comissão; o cupom do conteúdo vence o vínculo.
-- percent_source:
--   'item' → a % vem do produto (dono decide)   |   'rule' → a % vem daqui (admin decide)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.tb_affiliate_commission_rule (
  id_rule              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_context       VARCHAR(40) NOT NULL UNIQUE,
  regime               VARCHAR(16) NOT NULL,
  is_enabled           BOOLEAN     NOT NULL DEFAULT FALSE,
  percent              NUMERIC(5,2) NOT NULL DEFAULT 0,
  percent_source       VARCHAR(16) NOT NULL DEFAULT 'rule',
  creates_bond         BOOLEAN     NOT NULL DEFAULT FALSE,
  grants_discount      BOOLEAN     NOT NULL DEFAULT FALSE,
  max_pool_cents       INTEGER,
  min_order_cents      INTEGER     NOT NULL DEFAULT 0,
  recurring_allowed    BOOLEAN     NOT NULL DEFAULT TRUE,
  max_recurring_cycles INTEGER,
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by           UUID,
  CONSTRAINT tb_affiliate_commission_rule_regime_chk
    CHECK (regime IN ('platform', 'user')),
  CONSTRAINT tb_affiliate_commission_rule_source_chk
    CHECK (percent_source IN ('rule', 'item')),
  CONSTRAINT tb_affiliate_commission_rule_percent_chk
    CHECK (percent >= 0 AND percent <= 100)
);

-- Seed. is_enabled reproduz EXATAMENTE o que já gera comissão hoje: os contextos
-- novos (poléns/premium/manifestação/xp_boost/loja de funções) nascem desligados e
-- só são ligados no slice X1, com número decidido pelo Alex.
INSERT INTO public.tb_affiliate_commission_rule
  (source_context, regime, is_enabled, percent, percent_source, creates_bond, grants_discount, notes)
VALUES
  ('profile_subscription', 'platform', TRUE,  25, 'rule', TRUE,  TRUE,  'Ativação/compra de perfil.'),
  ('casa_conveniencia',    'platform', TRUE,  25, 'rule', TRUE,  TRUE,  'Conveniência Casa Views. Sai da margem.'),
  ('polen_purchase',       'platform', FALSE, 0,  'rule', TRUE,  TRUE,  'Ligar no X1. Nunca sobre pólen GASTO.'),
  ('premium',              'platform', FALSE, 0,  'rule', TRUE,  TRUE,  'Ligar no X1.'),
  ('manifestation',        'platform', FALSE, 0,  'rule', TRUE,  TRUE,  'Ligar no X1. Pago com pólen não conta.'),
  ('xp_boost',             'platform', FALSE, 0,  'rule', TRUE,  TRUE,  'Ligar no X1. Falta capturar ?cupom= no checkout.'),
  ('function_purchase',    'platform', FALSE, 0,  'rule', TRUE,  TRUE,  'Loja de Funções. Ligar no X1.'),
  ('loja_produto',         'user',     TRUE,  0,  'item', FALSE, FALSE, 'Produto de loja. % vem do dono.'),
  ('course_purchase',      'user',     TRUE,  0,  'item', FALSE, FALSE, 'Curso. % vem do dono.'),
  ('booking_deposit',      'user',     TRUE,  0,  'item', FALSE, FALSE, 'Sinal de agendamento. % vem do dono do serviço.')
ON CONFLICT (source_context) DO NOTHING;

-- clan_slot e community_slot NÃO recebem linha de propósito (decisão do Alex,
-- 2026-08-05): ficam fora do programa de afiliados.
