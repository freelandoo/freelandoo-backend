-- =============================================================================
-- Migration 193 — Vínculo vitalício de indicação (tb_user_referral)
-- =============================================================================
-- Slice V1 do desenho em docs/superpowers/specs/2026-08-05-afiliado-vitalicio-design.md
--
-- Usar o cupom de alguém numa compra da PLATAFORMA cria um vínculo permanente
-- entre comprador e afiliado. Daí em diante toda compra de plataforma daquele
-- usuário gera comissão para o afiliado vinculado e desconto para o comprador,
-- e o vínculo VENCE qualquer cupom de terceiro.
--
-- Compra de item de USUÁRIO (produto/curso/serviço) NÃO cria vínculo — lá quem
-- vence é o cupom de quem compartilhou o conteúdo.
--
-- O UNIQUE em id_user_referred é a regra de negócio inteira: o primeiro vínculo
-- vence e nunca é sobrescrito. Sem ele, "para sempre" é uma promessa que a
-- próxima venda quebra.
--
-- Esta migration NÃO muda comportamento: nada lê a tabela ainda (o resolvedor
-- entra no V2). Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_user_referral (
  id_referral      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user_referred UUID NOT NULL UNIQUE REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  id_affiliate     UUID NOT NULL REFERENCES public.tb_affiliate(id_affiliate),
  id_coupon        UUID REFERENCES public.tb_coupon(id_coupon),
  bound_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  bound_source     VARCHAR(24) NOT NULL,
  id_first_order   UUID REFERENCES public.tb_order(id_order),
  expires_at       TIMESTAMPTZ,
  released_at      TIMESTAMPTZ,
  released_reason  TEXT,
  released_by      UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tb_user_referral_source_chk
    CHECK (bound_source IN ('first_purchase', 'admin', 'backfill'))
);

CREATE INDEX IF NOT EXISTS ix_tb_user_referral_affiliate
  ON public.tb_user_referral (id_affiliate) WHERE released_at IS NULL;

COMMENT ON TABLE public.tb_user_referral IS
  'Vínculo vitalício comprador→afiliado. 1 por conta (UNIQUE), nunca sobrescrito. Nasce em compra de PLATAFORMA.';
COMMENT ON COLUMN public.tb_user_referral.expires_at IS
  'NULL = vitalício. Coluna existe para permitir recuo sem migration nova.';
COMMENT ON COLUMN public.tb_user_referral.released_at IS
  'Vínculo quebrado pelo admin (fraude/disputa). Para de pagar, fica no histórico.';

-- =============================================================================
-- tb_affiliate_conversion — de onde veio a atribuição e quanto virou desconto
-- =============================================================================
ALTER TABLE public.tb_affiliate_conversion
  ADD COLUMN IF NOT EXISTS id_referral             UUID REFERENCES public.tb_user_referral(id_referral),
  ADD COLUMN IF NOT EXISTS attribution_mode        VARCHAR(16),
  ADD COLUMN IF NOT EXISTS referral_discount_cents INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tb_affiliate_conversion_attr_mode_chk') THEN
    ALTER TABLE public.tb_affiliate_conversion
      ADD CONSTRAINT tb_affiliate_conversion_attr_mode_chk
      CHECK (attribution_mode IS NULL OR attribution_mode IN ('coupon', 'referral', 'content'));
  END IF;
END $$;

COMMENT ON COLUMN public.tb_affiliate_conversion.attribution_mode IS
  'coupon = cupom digitado/capturado | referral = vínculo vitalício | content = cupom do conteúdo compartilhado. Sem isto não dá para medir qual regime traz receita.';

-- =============================================================================
-- Backfill — liga o programa já com a base instalada
-- =============================================================================
-- Para cada comprador, a conversão MAIS ANTIGA de contexto PLATAFORMA vira o
-- vínculo. Contextos de usuário (loja/curso/booking) ficam de fora: comprar o
-- produto de alguém não vincula ninguém.
--
-- rule_snapshot->>'source_context' é NULL nas conversões do checkout legado
-- (ativação de perfil), que é plataforma — por isso o NULL entra.
INSERT INTO public.tb_user_referral
  (id_user_referred, id_affiliate, id_coupon, bound_at, bound_source, id_first_order)
SELECT DISTINCT ON (o.id_user)
  o.id_user,
  c.id_affiliate,
  c.id_coupon,
  c.created_at,
  'backfill',
  c.id_order
FROM public.tb_affiliate_conversion c
JOIN public.tb_order o ON o.id_order = c.id_order
JOIN public.tb_affiliate a ON a.id_affiliate = c.id_affiliate
WHERE c.status <> 'REVERSED'
  AND o.id_user IS NOT NULL
  AND a.id_user <> o.id_user
  AND COALESCE(c.rule_snapshot->>'source_context', '') NOT IN
      ('loja_produto', 'course_purchase', 'booking_deposit')
ORDER BY o.id_user, c.created_at ASC
ON CONFLICT (id_user_referred) DO NOTHING;
