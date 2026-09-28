-- =============================================================================
-- Migration 263: a TABELA DE PREÇOS nova — site por R$49/ano, site autoral por
-- R$299 + R$29/mês e o atendente de IA com camada grátis
-- =============================================================================
-- Decisão do Alex (2026-09-27), três produtos no lugar do Plano Negócio:
--
--   1. PLANO SITE — R$49 por ANO. O site padronizado (construtor + as seções
--      de Serviços e Loja do perfil). Montar continua grátis; o plano libera
--      PUBLICAR e o DOMÍNIO PRÓPRIO. Chave `site_share`.
--   2. SITE AUTORAL — feito pelos agentes da Freelandoo, sob medida. R$299 de
--      criação (pagos ao PEDIR o site) + R$29/mês de manutenção. É o plano
--      `site-freelandoo` da mig 241, reprecificado.
--   3. ATENDENTE DE IA — grátis para 2 PESSOAS por dia; acima disso, planos de
--      R$29 / R$59 / R$99 por mês conforme a cota de RESPOSTAS.
--
-- E o Plano Negócio (R$50/mês, `profissional`) ACABA.
--
-- ─── ⚠️ DESATIVAR O PLANO É O QUE LIBERA, E ISSO É O MECANISMO INTEIRO ───────
--
-- A posse (PlanService.ownershipMap) pergunta primeiro "a chave está em algum
-- plano ATIVO?". Com `profissional` inativo e as chaves que ele carregava
-- fora do `site-freelandoo`, `community_members`, `agenda`, `whatsapp` e
-- `atendimento_ia` deixam de ser "de plano" e caem no terceiro ramo — sem
-- produto à venda, GRÁTIS para todos. É exatamente o pedido: aceitar membros
-- deixa de ser pago, e o WhatsApp pode ser conectado de graça.
--
-- ⚠️ O `site-freelandoo` PRECISA perder as chaves copiadas (mig 241). Deixá-las
-- lá manteria agenda e WhatsApp "de plano" — e trancados para a base inteira,
-- porque um plano ativo continuaria vendendo as duas.
--
-- ─── ANUAL É UMA COLUNA, NÃO UM SEGUNDO FLUXO ───────────────────────────────
--
-- `billing_interval_months` (1 ou 12) desce até o gateway, que monta o
-- preapproval do Mercado Pago com `frequency: 12`. O webhook, a renovação e o
-- cancelamento no fim do ciclo são os mesmos — só o intervalo muda.
--
-- `setup_fee_cents` é INFORMATIVO no plano (o preço da criação que a tela
-- mostra). Quem cobra os R$299 é o PEDIDO do site (seção 5), não a
-- assinatura: o preapproval não tem "primeira cobrança diferente", e cobrar
-- a criação só quando o site já está pronto deixaria o trabalho feito sem
-- pagamento garantido.
--
-- Idempotente.
-- =============================================================================

-- ─── 1. Colunas do plano ─────────────────────────────────────────────────────
ALTER TABLE public.tb_plan
  ADD COLUMN IF NOT EXISTS billing_interval_months INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.tb_plan
  ADD COLUMN IF NOT EXISTS setup_fee_cents INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_plan_interval') THEN
    ALTER TABLE public.tb_plan
      ADD CONSTRAINT chk_plan_interval CHECK (billing_interval_months IN (1, 12));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_plan_setup_fee') THEN
    ALTER TABLE public.tb_plan
      ADD CONSTRAINT chk_plan_setup_fee CHECK (setup_fee_cents >= 0);
  END IF;
END $$;

-- ─── 2. O Plano Negócio acaba ────────────────────────────────────────────────
-- A linha fica (histórico de assinaturas aponta para ela); só sai de cena.
UPDATE public.tb_plan
   SET is_active = FALSE, updated_at = NOW()
 WHERE slug = 'profissional' AND is_active = TRUE;

-- ─── 3. O Plano Site — R$49 por ano ──────────────────────────────────────────
-- `sort_order` 5, ANTES do autoral: `planSellingFeature('site_share')` pega o
-- primeiro plano ativo que carrega a chave, e a recusa do Publicar tem que
-- apontar o plano de R$49 — não o de R$299.
INSERT INTO public.tb_plan (slug, name, tagline, description, price_cents, billing_interval_months, sort_order)
VALUES (
  'site',
  'Site',
  'Publique o site do seu negócio com endereço próprio.',
  'Monte o site no construtor, com os seus serviços e a sua loja entrando sozinhos, e publique com o endereço da Freelandoo ou o seu domínio. Pagamento anual.',
  4900,
  12,
  5
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.tb_plan_feature (id_plan, feature_key)
SELECT p.id_plan, 'site_share'
  FROM public.tb_plan p
 WHERE p.slug = 'site'
ON CONFLICT DO NOTHING;

-- ─── 4. O Site Autoral — R$299 de criação + R$29/mês ─────────────────────────
UPDATE public.tb_plan
   SET name            = 'Site Autoral',
       tagline         = 'Um site sob medida, feito pelos agentes da Freelandoo.',
       description     = 'Você pede e a Freelandoo desenha, escreve e publica um site exclusivo para o seu negócio. R$299 de criação, pagos ao fazer o pedido, e R$29 por mês de hospedagem e manutenção.',
       price_cents     = 2900,
       setup_fee_cents = 29900,
       sort_order      = 20,
       updated_at      = NOW()
 WHERE slug = 'site-freelandoo'
   AND (price_cents <> 2900 OR setup_fee_cents <> 29900 OR name <> 'Site Autoral');

DELETE FROM public.tb_plan_feature f
 USING public.tb_plan p
 WHERE p.id_plan = f.id_plan
   AND p.slug = 'site-freelandoo'
   AND f.feature_key IN ('agenda', 'whatsapp', 'community_members', 'atendimento_ia');

-- ─── 5. O pedido do site autoral passa a ser PAGO ────────────────────────────
-- Novo estado `awaiting_payment`: o pedido nasce aqui e só entra na fila
-- (`pending`) quando os R$299 caem. A fila do admin continua lendo só
-- `pending`, então pedido não pago nunca aparece como venda esperando.
ALTER TABLE public.tb_managed_site_request
  ADD COLUMN IF NOT EXISTS setup_cents INTEGER NULL;
ALTER TABLE public.tb_managed_site_request
  ADD COLUMN IF NOT EXISTS stripe_session_id VARCHAR(255) NULL;
ALTER TABLE public.tb_managed_site_request
  ADD COLUMN IF NOT EXISTS payment_ref VARCHAR(255) NULL;
ALTER TABLE public.tb_managed_site_request
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ NULL;
ALTER TABLE public.tb_managed_site_request
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ NULL;

ALTER TABLE public.tb_managed_site_request
  DROP CONSTRAINT IF EXISTS chk_managed_site_request_status;
ALTER TABLE public.tb_managed_site_request
  ADD CONSTRAINT chk_managed_site_request_status
  CHECK (status IN ('awaiting_payment', 'pending', 'answered', 'dismissed'));

-- Um pedido aguardando pagamento por comunidade: o segundo clique reaproveita
-- a linha (e troca a sessão) em vez de empilhar checkouts abandonados.
CREATE UNIQUE INDEX IF NOT EXISTS ux_managed_site_request_awaiting
  ON public.tb_managed_site_request (id_profile)
  WHERE status = 'awaiting_payment';

CREATE UNIQUE INDEX IF NOT EXISTS ux_managed_site_request_session
  ON public.tb_managed_site_request (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_managed_site_request_payment_ref
  ON public.tb_managed_site_request (payment_ref)
  WHERE payment_ref IS NOT NULL;

-- ─── 6. Atendente de IA: cota por RESPOSTAS ──────────────────────────────────
-- A cota vendida deixa de ser de tokens (unidade que o dono não enxerga) e
-- passa a ser de respostas — o que a tela consegue contar e o dono entende.
-- `token_limit_monthly` fica (NOT NULL, é do bot antigo), inerte.
ALTER TABLE public.tb_atendimento_ia_plan
  ADD COLUMN IF NOT EXISTS reply_limit_monthly INTEGER NULL;
ALTER TABLE public.tb_atendimento_ia_sub
  ADD COLUMN IF NOT EXISTS reply_limit_monthly INTEGER NULL;

UPDATE public.tb_atendimento_ia_plan
   SET monthly_cents = 2900, reply_limit_monthly = 300,
       description = 'Até 300 respostas por mês no WhatsApp e nas mensagens da Freelandoo.',
       updated_at = NOW()
 WHERE name = 'Básico' AND (monthly_cents <> 2900 OR reply_limit_monthly IS NULL);

UPDATE public.tb_atendimento_ia_plan
   SET monthly_cents = 5900, reply_limit_monthly = 1000,
       description = 'Até 1.000 respostas por mês no WhatsApp e nas mensagens da Freelandoo.',
       updated_at = NOW()
 WHERE name = 'Profissional' AND (monthly_cents <> 5900 OR reply_limit_monthly IS NULL);

UPDATE public.tb_atendimento_ia_plan
   SET monthly_cents = 9900, reply_limit_monthly = 3000,
       description = 'Até 3.000 respostas por mês no WhatsApp e nas mensagens da Freelandoo.',
       updated_at = NOW()
 WHERE name = 'Turbo' AND (monthly_cents <> 9900 OR reply_limit_monthly IS NULL);

-- As assinaturas "incluídas no Plano Negócio" acabam com o plano. Quem as
-- tinha cai na camada grátis — não fica sem atendente.
UPDATE public.tb_atendimento_ia_sub
   SET status = 'canceled', canceled_at = NOW(), updated_at = NOW()
 WHERE id_plan_subscription IS NOT NULL
   AND status IN ('active', 'past_due', 'pending');

-- A venda abre: agora é o produto, não um teste.
UPDATE public.tb_feature_flag
   SET is_enabled = TRUE, updated_at = NOW()
 WHERE flag_key = 'atendimento_ia_venda' AND is_enabled = FALSE;

-- Contagem da cota: respostas FEITAS por conta, numa janela de tempo.
CREATE INDEX IF NOT EXISTS ix_ai_reply_job_user_done
  ON public.tb_ai_reply_job (id_user, updated_at)
  WHERE status = 'done';

-- ─── 7. O aviso de cota esgotada ─────────────────────────────────────────────
-- A lista INTEIRA de novo, com o MESMO nome (regra das migs 153/197/249).
ALTER TABLE public.tb_notification
  DROP CONSTRAINT IF EXISTS tb_notification_type_chk;

ALTER TABLE public.tb_notification
  ADD CONSTRAINT tb_notification_type_chk
  CHECK (type IN (
    'like_received',
    'comment_received',
    'follow_received',
    'message_received',
    'supervised_message_received',
    'parental_permission_request',
    'product_request_new',
    'product_response_new',
    'product_sale',
    'course_sale',
    'booking_received',
    'service_response_received',
    'chamado_match',
    'affiliate_commission_released',
    'subscription_expiring',
    'premium_expiring',
    'manifestation_expiring',
    'live_started',
    'clan_invite',
    'clan_member_joined',
    'live_gift_received',
    'condo_claim_pending',
    'condo_claim_resolved',
    'condo_notice_received',
    'condo_poll_opened',
    'residence_claim_pending',
    'residence_recognized',
    'residence_contested',
    'residence_proof_requested',
    'residence_ended',
    'condo_family_request',
    'condo_dispute_opened',
    'condo_dispute_decided',
    'condo_proof_submitted',
    'whatsapp_quality_alert',
    'delivery_opened',
    'delivery_accepted',
    'delivery_delivered',
    'delivery_confirmed',
    'delivery_canceled',
    'listing_order_new',
    'listing_order_paid',
    'listing_order_confirmed',
    'listing_order_disputed',
    'listing_order_resolved',
    -- atendente de IA: a cota acabou (263)
    'ai_quota_reached'
  )) NOT VALID;
