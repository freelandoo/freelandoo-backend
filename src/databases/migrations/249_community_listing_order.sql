-- =============================================================================
-- Migration 249: VENDER DENTRO DA VITRINE (vizinho-a-vizinho) + o "+R$3"
--
-- Até aqui o anúncio da mig 198 NÃO VENDIA: ele tinha um campo `contact` e a
-- venda acontecia fora da plataforma. O pedido do Alex — "uma venda foi feita
-- de um serviço ou produto; se precisar que alguém busque, quem comprou pode
-- pagar R$3 a mais" — pressupõe um checkout que não existia. Ele é isto.
--
-- ─── ⚠️ AQUI O HOLDBACK DE 8 DIAS VOLTA A VALER ─────────────────────────────
--
-- E é o OPOSTO do delivery (mig 248), de propósito. A distinção não é de
-- tamanho, é de natureza:
--
--   delivery  → serviço EM MÃOS, dentro do prédio, confirmado na hora por quem
--               pediu. Não existe arrependimento de uma corrida que terminou.
--               Segurar R$1,01 por oito dias mataria a feature.
--   venda     → compra de BEM ou SERVIÇO contratado. O CDC dá 7 dias de
--               arrependimento, e o dinheiro precisa estar disponível para
--               voltar. É o mesmo regime de `tb_booking_payout` e
--               `tb_clan_payout`, e o mesmo número (8 dias).
--
-- ⚠️ NÃO UNIFICAR OS DOIS REGIMES. Quem "consertar" o delivery colocando
-- holdback, ou esta venda tirando, está trocando uma decisão jurídica por
-- simetria de código.
--
-- ─── O "+R$3" É UM ADD-ON, NÃO UM SEGUNDO PAGAMENTO ─────────────────────────
--
-- Quem compra marca "preciso que alguém traga" e o checkout cobra
-- `preço + entrega` DE UMA VEZ. Quando o pagamento cai, a plataforma abre um
-- chamado da mig 248 **já pago** — e é por isso que `tb_community_delivery_
-- request` ganha aqui a coluna `id_listing_order`: sem ela, o aceite tentaria
-- cobrar de novo e o vizinho pagaria a entrega duas vezes.
--
-- Idempotente.
-- =============================================================================

-- ─── 1. A régua da venda (admin-editável) ────────────────────────────────────
-- Singleton, no molde de `tb_booking_fee_settings` (mig 018/244).
--
-- ⚠️ A TAXA NASCE EM ZERO, e isso é decisão registrada: o Alex pediu o
-- checkout, mas NUNCA falou em taxa sobre a venda entre vizinhos — e cobrar sem
-- ele ter pedido seria inventar receita em cima de um bolo de R$30 vendido pela
-- vizinha do 302. Zero aqui não é "tela morta": a linha é LIDA de verdade, e
-- ligar a taxa é um UPDATE nela, sem deploy. O contrário (constante no service)
-- é o defeito que a mig 244 teve de desfazer no agendamento.
CREATE TABLE IF NOT EXISTS public.tb_community_listing_settings (
  id                  INT         PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  platform_fee_cents  INT         NOT NULL DEFAULT 0 CHECK (platform_fee_cents >= 0),
  platform_fee_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (platform_fee_percent >= 0),
  holdback_days       INT         NOT NULL DEFAULT 8 CHECK (holdback_days >= 0),
  -- Prazo que quem comprou tem para confirmar o recebimento. Vencido, a venda
  -- conclui sozinha — sem isto o repasse dependeria da boa vontade de quem já
  -- ficou com a coisa.
  confirm_days        INT         NOT NULL DEFAULT 7 CHECK (confirm_days > 0),
  is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by          UUID        NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL
);
INSERT INTO public.tb_community_listing_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ─── 2. O pedido ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_community_listing_order (
  id_order      BIGSERIAL    PRIMARY KEY,
  -- ⚠️ SET NULL, e não CASCADE: o anúncio pode ser arquivado ou apagado, e o
  -- PEDIDO tem que sobreviver — ele carrega dinheiro, disputa e histórico.
  -- É por isso que título e preço são gravados como SNAPSHOT logo abaixo.
  id_listing    BIGINT       NULL REFERENCES public.tb_condo_listing(id_listing) ON DELETE SET NULL,
  id_community  UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_buyer      UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  id_seller     UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,

  -- O SNAPSHOT. O vendedor pode reajustar o preço amanhã; o que foi combinado
  -- hoje é o que está aqui.
  listing_title VARCHAR(120) NOT NULL,
  listing_kind  VARCHAR(10)  NOT NULL CHECK (listing_kind IN ('service', 'product')),
  price_cents   INT          NOT NULL CHECK (price_cents >= 0),

  -- O ADD-ON "+R$3". Zero = a pessoa vai buscar sozinha.
  delivery_cents INT         NOT NULL DEFAULT 0 CHECK (delivery_cents >= 0),
  delivery_kind  VARCHAR(24) NULL,
  -- O chamado da mig 248 aberto por este pedido, quando o pagamento cai.
  id_delivery    BIGINT      NULL,

  -- O total cobrado = preço + entrega.
  amount_cents  INT          NOT NULL CHECK (amount_cents >= 0),

  platform_fee_cents   INT   NOT NULL DEFAULT 0 CHECK (platform_fee_cents >= 0),
  processor_fee_cents  INT   NOT NULL DEFAULT 0 CHECK (processor_fee_cents >= 0),
  processor_fee_source VARCHAR(12) NOT NULL DEFAULT 'none'
                         CHECK (processor_fee_source IN ('none', 'fallback', 'gateway')),
  -- O que sobra para quem vendeu. NUNCA negativo — um número negativo aqui
  -- viraria débito na carteira de quem entregou a mercadoria.
  seller_cents  INT          NOT NULL DEFAULT 0 CHECK (seller_cents >= 0),
  -- O que sobra para quem ENTREGA, quando houve add-on. Sai do mesmo charge,
  -- com a tarifa rateada proporcionalmente (ver utils/listingOrder.js).
  courier_cents INT          NOT NULL DEFAULT 0 CHECK (courier_cents >= 0),

  status        VARCHAR(16)  NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'paid', 'delivered', 'completed',
                                    'disputed', 'canceled', 'refunded')),

  payment_provider VARCHAR(16) NULL
                     CHECK (payment_provider IS NULL
                            OR payment_provider IN ('stripe', 'asaas')),
  session_id    TEXT         NULL,
  provider_ref  TEXT         NULL,
  checkout_url  TEXT         NULL,

  note          VARCHAR(500) NULL,

  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  paid_at       TIMESTAMPTZ  NULL,
  delivered_at  TIMESTAMPTZ  NULL,
  confirm_due_at TIMESTAMPTZ NULL,
  completed_at  TIMESTAMPTZ  NULL,
  canceled_at   TIMESTAMPTZ  NULL,
  refunded_at   TIMESTAMPTZ  NULL,
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Idempotência do webhook (mesma convenção das outras compras do projeto).
CREATE UNIQUE INDEX IF NOT EXISTS ux_listing_order_session
  ON public.tb_community_listing_order (session_id)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_listing_order_provider_ref
  ON public.tb_community_listing_order (provider_ref)
  WHERE provider_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_listing_order_buyer
  ON public.tb_community_listing_order (id_buyer, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_listing_order_seller
  ON public.tb_community_listing_order (id_seller, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_listing_order_community
  ON public.tb_community_listing_order (id_community, created_at DESC);

-- O sweeper de confirmação varre só o que foi entregue e não confirmado.
CREATE INDEX IF NOT EXISTS idx_listing_order_confirm_due
  ON public.tb_community_listing_order (confirm_due_at)
  WHERE status = 'delivered';

-- ─── 3. O repasse do vendedor (espelha tb_booking_payout) ───────────────────
-- ⚠️ AQUI `available_at` NASCE NO FUTURO: `NOW() + holdback_days`. É a única
-- diferença estrutural para o payout do delivery, e é a que carrega a decisão
-- jurídica (CDC, 7 dias de arrependimento numa compra remota).
CREATE TABLE IF NOT EXISTS public.tb_community_listing_payout (
  id_payout     BIGSERIAL    PRIMARY KEY,
  id_order      BIGINT       NOT NULL UNIQUE
                  REFERENCES public.tb_community_listing_order(id_order) ON DELETE CASCADE,
  id_community  UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_seller     UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  listing_title VARCHAR(120) NOT NULL,
  charge_cents  INT          NOT NULL CHECK (charge_cents >= 0),
  platform_fee_cents  INT    NOT NULL DEFAULT 0 CHECK (platform_fee_cents >= 0),
  processor_fee_cents INT    NOT NULL DEFAULT 0 CHECK (processor_fee_cents >= 0),
  net_cents     INT          NOT NULL CHECK (net_cents >= 0),
  status        VARCHAR(12)  NOT NULL DEFAULT 'aguardando'
                  CHECK (status IN ('aguardando', 'aprovado', 'pago', 'revertido')),
  available_at  TIMESTAMPTZ  NOT NULL,
  approved_at   TIMESTAMPTZ  NULL,
  paid_out_at   TIMESTAMPTZ  NULL,
  paid_out_note TEXT         NULL,
  reverted_at   TIMESTAMPTZ  NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_listing_payout_seller
  ON public.tb_community_listing_payout (id_seller, created_at DESC);

-- O sweeper de liberação (holdback vencido) varre só o que ainda aguarda.
CREATE INDEX IF NOT EXISTS idx_listing_payout_due
  ON public.tb_community_listing_payout (available_at)
  WHERE status = 'aguardando';

-- ─── 4. A disputa ────────────────────────────────────────────────────────────
-- ⚠️ É ELA QUE TORNA O SUB-PROJETO ENTREGÁVEL. Pôr dinheiro entre vizinhos sem
-- um caminho de "não chegou / não era isso" é pior que não ter checkout
-- nenhum: a plataforma vira a culpada de uma briga de corredor sem ter como
-- resolvê-la.
--
-- Abrir uma disputa CONGELA o repasse (o pedido vai para `disputed` e o payout
-- não é liberado pelo sweeper). Quem decide é o ADMIN DA PLATAFORMA — não o
-- síndico: ele é vizinho dos dois lados e julgar o 302 contra o 501 é o tipo de
-- poder que transforma o cargo em problema. (Difere do comprovante de
-- residência da mig 206, que o síndico lê porque ali ele é a autoridade
-- natural sobre quem mora no prédio.)
CREATE TABLE IF NOT EXISTS public.tb_community_listing_dispute (
  id_dispute   BIGSERIAL    PRIMARY KEY,
  id_order     BIGINT       NOT NULL REFERENCES public.tb_community_listing_order(id_order) ON DELETE CASCADE,
  id_opener    UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  reason       VARCHAR(24)  NOT NULL
                 CHECK (reason IN ('not_received', 'not_as_described', 'other')),
  detail       VARCHAR(1000) NULL,
  status       VARCHAR(16)  NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open', 'refunded', 'released', 'dismissed')),
  decided_by   UUID         NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  decision_note VARCHAR(1000) NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  decided_at   TIMESTAMPTZ  NULL
);

-- UMA disputa viva por pedido (mesmo padrão do índice parcial da fila de
-- fraude da mig 201 e da oferta de site da 242): sem isto, apertar duas vezes
-- empilha casos e a fila mostra a mesma briga N vezes.
CREATE UNIQUE INDEX IF NOT EXISTS ux_listing_dispute_open
  ON public.tb_community_listing_dispute (id_order)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_listing_dispute_queue
  ON public.tb_community_listing_dispute (created_at DESC)
  WHERE status = 'open';

-- ─── 5. O vínculo do "+R$3" com o chamado de entrega ─────────────────────────
-- ⚠️ SEM ESTA COLUNA O VIZINHO PAGARIA A ENTREGA DUAS VEZES: o chamado aberto
-- por um pedido já vem PAGO (o dinheiro entrou junto com o produto), e sem uma
-- marca dizendo isso o aceite criaria uma segunda cobrança.
ALTER TABLE public.tb_community_delivery_request
  ADD COLUMN IF NOT EXISTS id_listing_order BIGINT NULL;

CREATE INDEX IF NOT EXISTS idx_delivery_listing_order
  ON public.tb_community_delivery_request (id_listing_order)
  WHERE id_listing_order IS NOT NULL;

-- ─── 6. Notificações ─────────────────────────────────────────────────────────
-- ⚠️ SUPERSET COM O MESMO NOME DE CONSTRAINT (regra das migs 153/197/206/244/
-- 246/248). A lista INTEIRA de novo, com os valores novos no fim. Nome
-- diferente deixaria a constraint antiga de pé em paralelo, recusando
-- exatamente os valores que a nova passou a permitir.
ALTER TABLE public.tb_notification
  DROP CONSTRAINT IF EXISTS tb_notification_type_chk;

ALTER TABLE public.tb_notification
  ADD CONSTRAINT tb_notification_type_chk
  CHECK (type IN (
    -- social (057)
    'like_received',
    'comment_received',
    'follow_received',
    'message_received',
    -- supervisão (062)
    'supervised_message_received',
    'parental_permission_request',
    -- pedidos de produto (071)
    'product_request_new',
    'product_response_new',
    -- comercial (152)
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
    -- condomínio (197)
    'condo_claim_pending',
    'condo_claim_resolved',
    'condo_notice_received',
    'condo_poll_opened',
    -- residência (203/204)
    'residence_claim_pending',
    'residence_recognized',
    'residence_contested',
    'residence_proof_requested',
    'residence_ended',
    -- disputa (206)
    'condo_family_request',
    'condo_dispute_opened',
    'condo_dispute_decided',
    'condo_proof_submitted',
    -- WhatsApp oficial (246) — W6
    'whatsapp_quality_alert',
    -- delivery entre vizinhos (248)
    'delivery_opened',
    'delivery_accepted',
    'delivery_delivered',
    'delivery_confirmed',
    'delivery_canceled',
    -- venda dentro da vitrine (249)
    'listing_order_new',
    'listing_order_paid',
    'listing_order_confirmed',
    'listing_order_disputed',
    'listing_order_resolved'
  )) NOT VALID;

-- ─── 7. Feature flag ─────────────────────────────────────────────────────────
-- Nasce LIGADA (o Painel serve para DESLIGAR). Separada da do delivery: são
-- dois produtos, e segurar um não pode derrubar o outro.
INSERT INTO public.tb_feature_flag (flag_key, label, description)
VALUES (
  'vitrine_venda',
  'Venda na vitrine do vizinho',
  'Comprar pela plataforma o que o vizinho anuncia na vitrine do condomínio ou do bairro, com pagamento retido por 8 dias (CDC), confirmação de recebimento, disputa e a opção de somar uma entrega ao pedido. Desligar esconde o botão Comprar — os pedidos em andamento continuam podendo ser concluídos.'
)
ON CONFLICT (flag_key) DO NOTHING;
