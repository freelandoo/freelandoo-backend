-- =============================================================================
-- Migration 310: calendário de frequência e histórico de mensalidades (Esportes)
--
-- Pedido do Alex (2026-10-27): a "Minha academia" vira um calendário com ✓ nos
-- dias de catraca e ✕ nos dias sem entrada, e embaixo o histórico INTEIRO das
-- mensalidades, com "Pagar" pela Freelandoo quando a academia aceitar.
--
-- ─── O QUE ESTA MIGRATION FAZ ───────────────────────────────────────────────
--
-- 1. `tb_academy_payment.method`: a forma com que a academia recebeu (pix,
--    cartão, dinheiro, boleto…). Vem da API da academia; texto livre curto,
--    porque cada software chama de um jeito e a tela só mostra.
-- 2. `tb_academy_payment.paid_via`: 'academy' (o aluno pagou lá) ou
--    'freelandoo' (pagou aqui e a Freelandoo repassa). É o que pinta o talão de
--    "Pago via Freelandoo". Mora aqui e não só no pedido de pagamento porque o
--    espelho é o que a tela lê.
-- 3. `tb_academy.pay_callback`: a API da academia sabe receber a baixa
--    (`POST payments/:id/paid`)? Sem isso o "Pagar" NÃO aparece — pagar aqui
--    sem avisar lá deixaria a cobrança aberta no sistema da academia e o aluno
--    poderia pagar duas vezes.
--
-- Idempotente.
-- =============================================================================

ALTER TABLE public.tb_academy_payment
  ADD COLUMN IF NOT EXISTS method   VARCHAR(24) NULL,
  ADD COLUMN IF NOT EXISTS paid_via VARCHAR(12) NOT NULL DEFAULT 'academy';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_academy_payment_paid_via'
  ) THEN
    ALTER TABLE public.tb_academy_payment
      ADD CONSTRAINT chk_academy_payment_paid_via CHECK (paid_via IN ('academy', 'freelandoo'));
  END IF;
END $$;

ALTER TABLE public.tb_academy
  ADD COLUMN IF NOT EXISTS pay_callback            BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS capabilities_checked_at TIMESTAMPTZ NULL;
-- (O calendário lê por membro e intervalo: `idx_academy_event_member` da mig
-- 176 já cobre.)

-- =============================================================================
-- PAGAR A MENSALIDADE PELA FREELANDOO
--
-- Decisão do Alex (2026-10-27): o Mercado Pago da Freelandoo recebe, a
-- Freelandoo fica com a TARIFA REAL do Mercado Pago + R$ 2,50 por pagamento e o
-- resto vai por PIX para a chave que a academia cadastrou (pode ser uma conta
-- Asaas). O PIX é MANUAL (o admin faz e marca pago), igual aos repasses do
-- agendamento e da vitrine: o Mercado Pago não tem API aberta de PIX de saída
-- para conta qualquer.
--
-- ⚠️ HOLDBACK DE 8 DIAS, PIX E CARTÃO. Cartão tem contestação; mensalidade é
-- serviço contratado. Mesmo regime e mesmo número de `tb_booking_payout`.
-- =============================================================================

-- ─── A régua (admin-editável, singleton) ─────────────────────────────────────
-- Molde de `tb_community_listing_settings` (mig 249): ligar/mudar a taxa é um
-- UPDATE, nunca uma constante no service.
CREATE TABLE IF NOT EXISTS public.tb_academy_fee_settings (
  id                 INT         PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  platform_fee_cents INT         NOT NULL DEFAULT 250 CHECK (platform_fee_cents >= 0),
  holdback_days      INT         NOT NULL DEFAULT 8   CHECK (holdback_days >= 0),
  is_active          BOOLEAN     NOT NULL DEFAULT TRUE,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by         UUID        NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL
);
INSERT INTO public.tb_academy_fee_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ─── Para onde vai o dinheiro (uma linha por academia) ───────────────────────
-- Chave PIX e documento do titular SELADOS (`secretBox`, entram em ALVOS do
-- scripts/reseal-secrets.js). O titular tem que ser o dono (CPF da conta) ou a
-- própria academia (CNPJ) — o service confere; aqui só guarda.
CREATE TABLE IF NOT EXISTS public.tb_academy_payout_account (
  id_academy      UUID         PRIMARY KEY REFERENCES public.tb_academy(id_academy) ON DELETE CASCADE,
  pix_key_type    VARCHAR(8)   NOT NULL CHECK (pix_key_type IN ('cpf', 'cnpj', 'email', 'phone', 'random')),
  pix_key_sealed  TEXT         NOT NULL,
  -- Últimos caracteres, para a tela mostrar "•••• 4521" sem abrir o selo.
  pix_key_hint    VARCHAR(12)  NOT NULL,
  holder_name     VARCHAR(120) NOT NULL,
  holder_doc_type VARCHAR(4)   NOT NULL CHECK (holder_doc_type IN ('cpf', 'cnpj')),
  holder_doc_sealed TEXT       NOT NULL,
  holder_doc_hint VARCHAR(8)   NOT NULL,
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_by      UUID         NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL
);

-- ─── O pedido (um checkout) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_academy_fee_order (
  id_order        BIGSERIAL    PRIMARY KEY,
  id_academy      UUID         NOT NULL REFERENCES public.tb_academy(id_academy) ON DELETE CASCADE,
  -- SET NULL: o aluno pode se desvincular; o pedido carrega dinheiro e fica.
  id_member       UUID         NULL REFERENCES public.tb_academy_member(id_member) ON DELETE SET NULL,
  id_user         UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  -- A cobrança LÁ na academia (o `id` da Gym Provider API).
  external_id     TEXT         NOT NULL,
  due_date        TIMESTAMPTZ  NULL,
  amount_cents    INT          NOT NULL CHECK (amount_cents > 0),
  platform_fee_cents   INT     NOT NULL DEFAULT 0 CHECK (platform_fee_cents >= 0),
  processor_fee_cents  INT     NOT NULL DEFAULT 0 CHECK (processor_fee_cents >= 0),
  processor_fee_source VARCHAR(12) NOT NULL DEFAULT 'none'
                         CHECK (processor_fee_source IN ('none', 'fallback', 'gateway')),
  -- O que vai para a academia. Nunca negativo.
  net_cents       INT          NOT NULL DEFAULT 0 CHECK (net_cents >= 0),
  status          VARCHAR(12)  NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'paid', 'canceled', 'refunded')),
  payment_provider VARCHAR(16) NULL
                    CHECK (payment_provider IS NULL OR payment_provider IN ('stripe', 'asaas', 'mercadopago')),
  session_id      TEXT         NULL,
  provider_ref    TEXT         NULL,
  checkout_url    TEXT         NULL,
  -- A baixa na API da academia. Sem resposta, o varredor tenta de novo: a
  -- academia não saber que recebeu é o defeito que esta feature não pode ter.
  academy_notified_at  TIMESTAMPTZ NULL,
  academy_notify_tries INT         NOT NULL DEFAULT 0,
  academy_notify_error TEXT        NULL,
  -- Estorno ANTES do repasse: a cobrança tem que reabrir lá.
  academy_reopen_needed BOOLEAN    NOT NULL DEFAULT FALSE,
  academy_reopened_at  TIMESTAMPTZ NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  paid_at         TIMESTAMPTZ  NULL,
  canceled_at     TIMESTAMPTZ  NULL,
  refunded_at     TIMESTAMPTZ  NULL,
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ⚠️ UM checkout vivo por cobrança: dois cliques (ou duas abas) não abrem duas
-- cobranças da mesma mensalidade. Paga uma vez, nunca mais.
CREATE UNIQUE INDEX IF NOT EXISTS ux_academy_fee_order_open
  ON public.tb_academy_fee_order (id_academy, external_id)
  WHERE status IN ('pending', 'paid');
CREATE INDEX IF NOT EXISTS idx_academy_fee_order_session
  ON public.tb_academy_fee_order (session_id);
CREATE INDEX IF NOT EXISTS idx_academy_fee_order_ref
  ON public.tb_academy_fee_order (provider_ref);
CREATE INDEX IF NOT EXISTS idx_academy_fee_order_member
  ON public.tb_academy_fee_order (id_member, created_at DESC);

-- ─── O repasse ───────────────────────────────────────────────────────────────
-- aguardando → (holdback) → aprovado → (admin fez o PIX) → pago
-- estorno antes do PIX → revertido; estorno depois → devido (a academia deve).
CREATE TABLE IF NOT EXISTS public.tb_academy_payout (
  id_payout           BIGSERIAL    PRIMARY KEY,
  id_order            BIGINT       NOT NULL UNIQUE REFERENCES public.tb_academy_fee_order(id_order) ON DELETE CASCADE,
  id_academy          UUID         NOT NULL REFERENCES public.tb_academy(id_academy) ON DELETE CASCADE,
  charge_cents        INT          NOT NULL CHECK (charge_cents >= 0),
  platform_fee_cents  INT          NOT NULL DEFAULT 0 CHECK (platform_fee_cents >= 0),
  processor_fee_cents INT          NOT NULL DEFAULT 0 CHECK (processor_fee_cents >= 0),
  net_cents           INT          NOT NULL CHECK (net_cents >= 0),
  status              VARCHAR(12)  NOT NULL DEFAULT 'aguardando'
                        CHECK (status IN ('aguardando', 'aprovado', 'pago', 'revertido', 'devido')),
  available_at        TIMESTAMPTZ  NOT NULL,
  approved_at         TIMESTAMPTZ  NULL,
  paid_out_at         TIMESTAMPTZ  NULL,
  paid_out_note       VARCHAR(300) NULL,
  paid_out_by         UUID         NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_academy_payout_academy
  ON public.tb_academy_payout (id_academy, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_academy_payout_status
  ON public.tb_academy_payout (status, available_at);

-- ─── Notificação ao dono: "Fulano pagou a mensalidade" ──────────────────────
-- SUPERSET da lista da mig 266, mesmo nome de constraint (regra das CHECKs de
-- enum). NOT VALID como lá: linhas antigas não são relidas no boot.
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
    'ai_quota_reached',
    -- delivery por peso: chegou uma contraproposta (266)
    'delivery_proposal',
    -- mensalidade da academia paga pela Freelandoo (310)
    'academy_fee_paid'
  )) NOT VALID;
