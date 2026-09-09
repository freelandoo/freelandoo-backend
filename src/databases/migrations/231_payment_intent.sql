-- =============================================================================
-- Migration 231: tb_payment_intent — a intenção de pagamento sai do GATEWAY
--                e passa a morar no NOSSO banco (fundação da troca Stripe→Asaas)
-- =============================================================================
-- POR QUE ISTO EXISTE
--
-- Hoje o que um pagamento SIGNIFICA mora dentro do Stripe: o webhook lê
-- `session.metadata.type` para saber se aquilo é compra de Polén, vaga de
-- condomínio ou mensalidade, e lê `metadata.user_id`, `.product_id`,
-- `.polens_amount`, `.coupon_code`… O Stripe aceita um MAPA arbitrário de
-- metadata, então deu para pendurar o negócio inteiro lá.
--
-- ⚠️ O ASAAS NÃO TEM METADATA. Tem `externalReference`, que é UMA STRING.
-- Conferido na doc (PaymentSaveRequestDTO, set/2026). Não existe onde pendurar
-- oito campos, e concatená-los numa string separada por pipe seria inventar um
-- formato de serialização sem validação, que quebra no primeiro valor com o
-- separador dentro.
--
-- A saída é inverter a posse: a intenção nasce AQUI, antes de falar com o
-- gateway, e o `externalReference` carrega só o id dela. O webhook recebe o id,
-- busca a linha e recupera o payload inteiro.
--
-- ⚠️ E ISSO VALE PARA O STRIPE TAMBÉM, de propósito. Se só o Asaas escrevesse
-- aqui, teríamos duas verdades sobre "o que foi comprado" — uma no metadata do
-- Stripe e outra nesta tabela — e o radar de presos, a reconciliação e o painel
-- admin teriam que perguntar em dois lugares e concordar. Uma tabela só,
-- alimentada pelos dois provedores, é o que torna a migração fluxo-a-fluxo
-- possível sem o admin passar a mentir no meio do caminho.
--
-- ⚠️ NÃO SUBSTITUI as colunas `stripe_session_id` espalhadas pelas 15 tabelas
-- de pedido. Aquelas são o estado DAQUELE fluxo (o pedido da loja, a compra de
-- Polén) e continuam mandando na entrega. Esta tabela responde outra pergunta:
-- "o que esta cobrança no gateway queria dizer?". Colapsar as duas exigiria
-- reescrever os 18 confirmadores de uma vez — exatamente o risco que o
-- fatiamento existe para evitar.

CREATE TABLE IF NOT EXISTS public.tb_payment_intent (
  id_payment_intent    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Lista fechada: é o que impede um provedor inventado de entrar por um
  -- caminho de código que esqueceu de validar. Provedor novo = migration nova,
  -- e é para ser assim — o confirmador dele precisa existir antes.
  provider             TEXT        NOT NULL,

  -- O antigo `metadata.type` (polen_purchase, booking_deposit, premium…).
  -- SEM CHECK de propósito: a lista fechada mora no JS (utils/paymentFlows.js)
  -- porque fluxo novo entra junto do código que sabe confirmá-lo, e um CHECK
  -- aqui obrigaria uma migration para cada produto novo da loja.
  flow                 TEXT        NOT NULL,

  -- SET NULL e não CASCADE: apagar a conta não pode apagar o rastro de um
  -- pagamento que existiu, foi cobrado e talvez precise ser reembolsado.
  id_user              UUID        REFERENCES public.tb_user(id_user) ON DELETE SET NULL,

  -- O mapa que o Stripe guardava. É daqui que o webhook do Asaas vai reidratar
  -- o que a cobrança significava.
  payload              JSONB       NOT NULL DEFAULT '{}'::jsonb,

  amount_cents         INTEGER     NOT NULL,
  currency             TEXT        NOT NULL DEFAULT 'BRL',

  status               TEXT        NOT NULL DEFAULT 'created',

  -- Id da cobrança no gateway: checkout session (Stripe) ou payment/subscription
  -- (Asaas). Nasce NULL — a linha existe ANTES da chamada de rede, senão uma
  -- falha no meio dela deixaria a cobrança de pé no gateway sem nada aqui.
  provider_ref         TEXT,
  provider_customer_id TEXT,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.tb_payment_intent
  DROP CONSTRAINT IF EXISTS tb_payment_intent_provider_check;
ALTER TABLE public.tb_payment_intent
  ADD CONSTRAINT tb_payment_intent_provider_check
  CHECK (provider IN ('stripe','asaas'));

ALTER TABLE public.tb_payment_intent
  DROP CONSTRAINT IF EXISTS tb_payment_intent_status_check;
ALTER TABLE public.tb_payment_intent
  ADD CONSTRAINT tb_payment_intent_status_check
  CHECK (status IN ('created','paid','canceled','expired','refunded','failed'));

ALTER TABLE public.tb_payment_intent
  DROP CONSTRAINT IF EXISTS tb_payment_intent_amount_check;
ALTER TABLE public.tb_payment_intent
  ADD CONSTRAINT tb_payment_intent_amount_check
  CHECK (amount_cents >= 0);

-- ⚠️ UNIQUE PARCIAL, e o parcial é o ponto: a linha nasce com provider_ref NULL
-- (antes da ida ao gateway) e um UNIQUE cego recusaria a segunda intenção ainda
-- não enviada. Depois de preenchido, o par (provider, ref) é único — é o que
-- impede duas intenções reivindicarem a mesma cobrança quando um retry cria a
-- linha de novo.
CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_intent_provider_ref
  ON public.tb_payment_intent (provider, provider_ref)
  WHERE provider_ref IS NOT NULL;

-- Radar de intenção presa: criada, mandada ao gateway e nunca confirmada — o
-- sintoma de "pagou mas não recebeu" e de checkout abandonado.
CREATE INDEX IF NOT EXISTS ix_payment_intent_stale
  ON public.tb_payment_intent (created_at DESC)
  WHERE status = 'created';

CREATE INDEX IF NOT EXISTS ix_payment_intent_user
  ON public.tb_payment_intent (id_user, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_payment_intent_flow
  ON public.tb_payment_intent (flow, status);

-- ─────────────────────────────────────────────────────────────────────────────
-- Telemetria de webhook deixa de ser só do Stripe.
--
-- ⚠️ O NOME FÍSICO `tb_stripe_webhook_event` FICA E PASSA A MENTIR, de
-- propósito — mesma decisão de tb_machine (que guarda enxames), tb_story (que
-- guarda bees) e tb_games_presence (que guarda o Financeiro): nome físico é
-- LEGADO, rename é só de aplicação. A mig 145 já rodou em produção e o runner
-- compara checksum.
--
-- `event_id` continua a chave de dedupe: no Stripe é `evt_…`, no Asaas é o `id`
-- do evento — que a doc manda persistir exatamente por isto (entrega
-- at-least-once, eventos chegam duplicados).
ALTER TABLE public.tb_stripe_webhook_event
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'stripe';

ALTER TABLE public.tb_stripe_webhook_event
  DROP CONSTRAINT IF EXISTS tb_stripe_webhook_event_provider_check;
ALTER TABLE public.tb_stripe_webhook_event
  ADD CONSTRAINT tb_stripe_webhook_event_provider_check
  CHECK (provider IN ('stripe','asaas'));

-- Sem backfill: o DEFAULT já carimba 'stripe' nas linhas existentes, e todas
-- são do Stripe por construção (não havia outro provedor).
