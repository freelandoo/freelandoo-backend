-- =============================================================================
-- Migration 234: o Plano NEGÓCIO — o negócio e o site são de todo mundo; o que
-- se paga é MEMBROS, COMPARTILHAR O SITE e o ATENDENTE DE IA (R$50/mês)
-- =============================================================================
-- Pedido do Alex (2026-09-10): "todos tenham acesso ao meus negócios, tenham
-- acesso a fazer um site dele, a montar o negócio dele, mas não consegue
-- adicionar membros e nem compartilhar o site dele, só se pagar (...) crie seu
-- negócio, faça um site para você e ainda tenha um atendente de IA para
-- atender seu WhatsApp e suas mensagens da Freelandoo, por 50 reais mensais".
--
-- ─── O QUE A MIG 225 FAZIA E POR QUE ISTO A INVERTE ─────────────────────────
--
-- A 225 pôs a chave `communities` INTEIRA dentro do plano: sem assinar, a
-- pessoa nem via o pill Business — a porta do negócio estava trancada. O
-- pedido de agora é o contrário: a porta é de todo mundo, e o plano libera o
-- que vem DEPOIS de o negócio existir. Então:
--
--   • `communities` SAI do plano. Como ela já está `is_for_sale = FALSE`
--     (a 225 a tirou da vitrine), fora do plano ela cai no terceiro ramo do
--     ownership — GRÁTIS para todos. É exatamente o efeito pedido.
--   • Entram TRÊS chaves novas, uma por porta paga:
--       community_members  → aceitar membro no negócio (join / convite)
--       site_share         → PUBLICAR o site (é o que o torna compartilhável)
--       atendimento_ia     → o bot de atendimento, incluído no plano
--     As três estão em `USER_FEATURE_KEYS` (fonte única da whitelist) — chave
--     de plano fora dela não entra no mapa de posse que o front lê.
--
-- ⚠️ MONTAR o site continua livre: só a PUBLICAÇÃO passa pela porta. Sem site
-- para montar, a pessoa não tem o que decidir comprar.
--
-- ─── O ATENDENTE DE IA "INCLUÍDO" ───────────────────────────────────────────
--
-- O Atendimento IA (mig 175) tem tabela, provisionamento e cota de tokens
-- próprios, e continua sendo vendido à parte por quem quiser mais cota. O que
-- o Plano Negócio faz é ABRIR uma assinatura de Atendimento IA sem cobrança
-- para quem assina o plano — reusando o MESMO ciclo (provisionar, revogar,
-- pausar por cota), em vez de um segundo bot.
--
-- Para isso: (1) o CHECK `monthly_cents > 0` das duas tabelas vira `>= 0`
-- (uma linha de R$0 é o que "incluído" quer dizer); (2) um plano de
-- Atendimento IA "Incluído no Plano Negócio", `is_active = FALSE` para NUNCA
-- aparecer na vitrine nem aceitar checkout — só o PlanService o usa;
-- (3) `tb_atendimento_ia_sub.id_plan_subscription` aponta para a assinatura do
-- plano que a abriu. É o marcador que separa "incluída" de "paga": quem já
-- paga o Atendimento IA à parte NÃO recebe a incluída (manteria a cota maior
-- que comprou), e quando o plano acaba só a incluída cai.
--
-- Idempotente.
-- =============================================================================

-- ─── 1. O plano vira o Plano NEGÓCIO ───────────────────────────────────────
-- O slug (`profissional`) é identificador e fica; o que a pessoa lê muda.
UPDATE public.tb_plan
   SET name        = 'Negócio',
       tagline     = 'Seu negócio, seu site e um atendente de IA no seu WhatsApp.',
       description = 'Crie seu negócio e monte o site dele de graça. Com o Plano Negócio você aceita membros, publica e compartilha o site com endereço próprio, e ganha um atendente de IA que responde o WhatsApp da sua empresa e as suas mensagens da Freelandoo.',
       updated_at  = NOW()
 WHERE slug = 'profissional'
   AND name <> 'Negócio';

-- ─── 2. As chaves do plano ─────────────────────────────────────────────────
DELETE FROM public.tb_plan_feature
 WHERE feature_key = 'communities';

INSERT INTO public.tb_plan_feature (id_plan, feature_key)
SELECT p.id_plan, k.feature_key
  FROM public.tb_plan p
  CROSS JOIN (VALUES ('community_members'), ('site_share'), ('atendimento_ia')) AS k(feature_key)
 WHERE p.slug = 'profissional'
ON CONFLICT DO NOTHING;

-- O negócio é grátis: fora do plano E fora da vitrine (a 225 já tinha tirado
-- da vitrine; o guard abaixo só garante o estado se alguém religou no admin).
UPDATE public.tb_function_product
   SET is_for_sale = FALSE, updated_at = NOW()
 WHERE feature_key = 'communities'
   AND is_for_sale = TRUE;

-- ─── 3. Atendimento IA aceita linha de R$0 ─────────────────────────────────
-- Os CHECKs da 175 eram inline (sem nome): acha-os pela definição e troca por
-- constraints NOMEADAS, que é o que deixa a próxima migration referenciá-las.
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname, conrelid::regclass AS rel
      FROM pg_constraint
     WHERE contype = 'c'
       AND conrelid IN ('public.tb_atendimento_ia_plan'::regclass,
                        'public.tb_atendimento_ia_sub'::regclass)
       AND pg_get_constraintdef(oid) ILIKE '%monthly_cents > 0%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.rel, c.conname);
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_atendimento_ia_plan_monthly_cents') THEN
    ALTER TABLE public.tb_atendimento_ia_plan
      ADD CONSTRAINT chk_atendimento_ia_plan_monthly_cents CHECK (monthly_cents >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_atendimento_ia_sub_monthly_cents') THEN
    ALTER TABLE public.tb_atendimento_ia_sub
      ADD CONSTRAINT chk_atendimento_ia_sub_monthly_cents CHECK (monthly_cents >= 0);
  END IF;
END $$;

-- O plano de Atendimento IA que o Plano Negócio abre. `is_active = FALSE` de
-- propósito: `listPlans` (vitrine) e `createCheckout` só enxergam ativos, então
-- ninguém compra nem vê este — só o PlanService o lê, por nome.
INSERT INTO public.tb_atendimento_ia_plan (name, description, monthly_cents, token_limit_monthly, sort_order, is_active)
SELECT 'Incluído no Plano Negócio',
       'Atendente de IA incluído no Plano Negócio: responde o WhatsApp da sua empresa e suas mensagens da Freelandoo.',
       0, 300000, 0, FALSE
 WHERE NOT EXISTS (
   SELECT 1 FROM public.tb_atendimento_ia_plan WHERE name = 'Incluído no Plano Negócio'
 );

-- ─── 4. O marcador de "incluída" ───────────────────────────────────────────
ALTER TABLE public.tb_atendimento_ia_sub
  ADD COLUMN IF NOT EXISTS id_plan_subscription UUID NULL
    REFERENCES public.tb_user_plan_subscription(id_subscription) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_atendimento_ia_sub_plan_subscription
  ON public.tb_atendimento_ia_sub (id_plan_subscription)
  WHERE id_plan_subscription IS NOT NULL;
