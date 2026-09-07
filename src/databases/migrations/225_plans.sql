-- =============================================================================
-- Migration 225: Planos mensais — o pacote que substitui a venda avulsa
-- =============================================================================
-- Decisão do Alex (2026-09-06): um plano mensal reúne site, agendamento e
-- WhatsApp, e as funções desse pacote SAEM da venda avulsa da Loja. O
-- atendimento automático (Atendimento IA, mig 175) fica FORA: continua vendido
-- à parte, nos planos de token que já existem.
--
-- ─── A ARMADILHA QUE ESTA MIGRATION EXISTE PARA RESOLVER ────────────────────
--
-- Hoje a posse de uma função tem só DOIS estados, e eles são a mesma coluna:
--
--     owned = !product.is_for_sale || comprou
--
-- Ou seja: `is_for_sale = FALSE` significa **GRÁTIS PARA TODO MUNDO** — foi
-- assim que Carteira (216), Academia/Vaquinha (217) e Serviços (222) viraram
-- nativas. Tirar Comunidade e Agenda da venda "porque agora são do plano"
-- daria o oposto do pedido: elas ficariam liberadas para a base inteira.
--
-- O terceiro estado nasce aqui, e a fonte dele é a TABELA DE PLANOS, não uma
-- coluna nova em `tb_function_product`:
--
--     está em plano ativo  → só quem assina (ou quem já comprou vitalício)
--     à venda              → só quem comprou
--     nem uma coisa nem outra, e fora de venda → grátis
--
-- Guardar isso numa coluna do produto criaria a segunda verdade de sempre: a
-- coluna diria "é de plano" e a tabela de planos diria quais chaves ele tem, e
-- um dia as duas discordariam. Aqui a pergunta "esta função é de plano?" tem
-- uma resposta só: existe linha em `tb_plan_feature` de um plano ativo.
--
-- ─── QUEM JÁ COMPROU NÃO PERDE ─────────────────────────────────────────────
--
-- Compra vitalícia paga VENCE o plano, sempre (é o primeiro teste no
-- ownership). Em produção existe exatamente UMA (`communities`, paga em
-- Poléns) — o grandfather é pequeno, mas a regra vale para sempre: vender
-- vitalício e depois exigir assinatura da mesma pessoa seria retomar o que já
-- foi pago.
--
-- ─── UMA ASSINATURA VIVA POR PESSOA ────────────────────────────────────────
--
-- `ux_user_plan_active` (parcial) impede a segunda: com duas, "qual plano vale"
-- viraria uma pergunta sem resposta, e o Stripe cobraria as duas. Trocar de
-- plano é encerrar uma e abrir outra.
--
-- Idempotente. (O runner já envolve cada migration em transação própria.)
-- =============================================================================

-- ─── 1. O plano ────────────────────────────────────────────────────────────
-- Preço em CENTAVOS, como todo o resto do dinheiro no projeto. Sem
-- `stripe_price_id`: a casa cobra com `price_data` ad-hoc (mig 036 em diante),
-- o que deixa o admin mudar o preço sem tocar no dashboard do Stripe.
CREATE TABLE IF NOT EXISTS public.tb_plan (
  id_plan      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         VARCHAR(48) NOT NULL,
  name         VARCHAR(120) NOT NULL,
  tagline      VARCHAR(240) NULL,
  description  TEXT NULL,
  price_cents  INTEGER NOT NULL,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_plan_slug ON public.tb_plan (slug);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_plan_price') THEN
    ALTER TABLE public.tb_plan
      ADD CONSTRAINT chk_plan_price CHECK (price_cents >= 0);
  END IF;
END $$;

-- ─── 2. O que o plano inclui ───────────────────────────────────────────────
-- `feature_key` é a MESMA chave da whitelist de funções (`userFeatureKeys.js`)
-- — não uma lista paralela. Sem FK para `tb_function_product` de propósito: a
-- chave pode existir como função de usuário sem ter linha no catálogo da Loja
-- (é o caso do WhatsApp, que nunca foi vendido avulso), e uma FK obrigaria a
-- criar produto de vitrine para algo que não está à venda.
CREATE TABLE IF NOT EXISTS public.tb_plan_feature (
  id_plan     UUID NOT NULL REFERENCES public.tb_plan(id_plan) ON DELETE CASCADE,
  feature_key VARCHAR(48) NOT NULL,
  PRIMARY KEY (id_plan, feature_key)
);

CREATE INDEX IF NOT EXISTS ix_plan_feature_key
  ON public.tb_plan_feature (feature_key);

-- ─── 3. A assinatura ───────────────────────────────────────────────────────
-- `status` espelha o vocabulário do Stripe, e os quatro estados pedem
-- tratamento diferente na tela e no acesso:
--   pending   → checkout aberto, ninguém pagou ainda. NÃO dá acesso.
--   active    → em dia.
--   past_due  → a fatura falhou e o Stripe ainda está tentando. MANTÉM o
--               acesso, como o Atendimento IA (mig 175) já faz: cortar no
--               primeiro erro de cartão derrubaria o negócio de quem só
--               trocou de banco.
--   canceled  → acabou. Sem acesso depois do fim do período pago.
CREATE TABLE IF NOT EXISTS public.tb_user_plan_subscription (
  id_subscription        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user                UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  id_plan                UUID NOT NULL REFERENCES public.tb_plan(id_plan),
  status                 VARCHAR(16) NOT NULL DEFAULT 'pending',
  -- Preço PAGO, congelado na contratação: o admin reajusta o plano e quem já
  -- assinou continua vendo (e devendo) o que contratou até trocar.
  price_cents            INTEGER NOT NULL,
  stripe_session_id      VARCHAR(255) NULL,
  stripe_subscription_id VARCHAR(255) NULL,
  stripe_customer_id     VARCHAR(255) NULL,
  current_period_end     TIMESTAMPTZ NULL,
  started_at             TIMESTAMPTZ NULL,
  canceled_at            TIMESTAMPTZ NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_plan_sub_status') THEN
    ALTER TABLE public.tb_user_plan_subscription
      ADD CONSTRAINT chk_plan_sub_status
      CHECK (status IN ('pending', 'active', 'past_due', 'canceled'));
  END IF;
END $$;

-- Uma assinatura VIVA por pessoa. Parcial, como o vínculo de morador (mig 203):
-- o histórico de assinaturas encerradas continua na tabela.
CREATE UNIQUE INDEX IF NOT EXISTS ux_user_plan_active
  ON public.tb_user_plan_subscription (id_user)
  WHERE status IN ('active', 'past_due');

-- Dedupe do checkout, mesmo padrão da Loja de Funções (mig 191): o webhook
-- pode entregar a mesma sessão duas vezes.
CREATE UNIQUE INDEX IF NOT EXISTS ux_plan_sub_session
  ON public.tb_user_plan_subscription (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_plan_sub_stripe
  ON public.tb_user_plan_subscription (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_plan_sub_user
  ON public.tb_user_plan_subscription (id_user, status);

-- ─── 4. O plano de entrada ─────────────────────────────────────────────────
-- R$50/mês. A composição é EDITÁVEL (é uma tabela, não código): acrescentar
-- uma função ao pacote é inserir uma linha em `tb_plan_feature`.
--
-- ⚠️ O que NÃO entra, e por quê:
--   • `services`, `wallet`, `vitrine`, `vaquinha`, `fitness_academias` são
--     GRÁTIS hoje (migs 216/217/222). Pô-las no plano TIRARIA da base o que
--     ela já tem — regressão, não empacotamento.
--   • `courses`, `store`, `profiles` continuam à venda avulsa: não foram
--     pedidos no pacote e ninguém perde nada por isso.
--   • O atendimento automático fica fora: é o Atendimento IA (mig 175), com
--     cota de tokens própria, vendido à parte.
INSERT INTO public.tb_plan (slug, name, tagline, description, price_cents, sort_order)
VALUES (
  'profissional',
  'Profissional',
  'Seu site, sua agenda e seu WhatsApp num lugar só.',
  'Publique o site do seu negócio com endereço próprio, receba agendamentos online com sinal e atenda o WhatsApp da sua empresa sem sair da Freelandoo. O atendimento automático por IA é vendido à parte, com cota própria.',
  5000,
  10
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.tb_plan_feature (id_plan, feature_key)
SELECT p.id_plan, k.feature_key
  FROM public.tb_plan p
  CROSS JOIN (VALUES ('communities'), ('agenda'), ('whatsapp')) AS k(feature_key)
 WHERE p.slug = 'profissional'
ON CONFLICT DO NOTHING;

-- ─── 5. As funções do pacote saem da vitrine avulsa ────────────────────────
-- `is_for_sale = FALSE` tira da vitrine `/funcoes` e faz o checkout recusar —
-- e, agora que elas estão em `tb_plan_feature`, isso NÃO as torna grátis (é
-- exatamente o terceiro estado que esta migration criou).
--
-- A linha NUNCA é apagada, pela regra da mig 191: o catálogo é fechado e
-- apagar tiraria o produto do admin junto com a chance de reverter num clique.
-- Preço também fica como está — inerte enquanto `is_for_sale` é FALSE.
UPDATE public.tb_function_product
   SET is_for_sale = FALSE, updated_at = NOW()
 WHERE feature_key IN ('communities', 'agenda')
   AND is_for_sale = TRUE;
