-- =============================================================================
-- Migration 266: o delivery entre vizinhos passa a ser por PESO, com direção
--                (levar × trazer), oferta de quem pede e contraproposta.
--
-- Decisão do Alex (2026-09-27): "quando alguém abrir um delivery, todos os
-- membros recebem um modal: fulano deseja receber ou enviar uma encomenda,
-- você pode levar ou buscar. O padrão é R$3,00 até 1 kg; se ninguém aceitar,
-- quem pediu pode oferecer mais. De 1 a 3 kg é R$5 o mínimo, de 3 a 6 kg
-- R$15, de 6 a 10 kg R$20, e mais de 10 kg abre negociação." Na negociação,
-- o vizinho aceita o valor oferecido ou faz uma contraproposta, e quem pediu
-- escolhe uma delas.
--
-- ── O QUE MUDA E O QUE NÃO MUDA ─────────────────────────────────────────────
-- O ciclo da mig 248 fica inteiro: cobra NO ACEITE, quem entrega absorve a
-- tarifa, quem pediu confirma com prazo. O que muda é de onde sai o PREÇO:
-- antes era o da tabela por tipo (comida R$3, encomenda R$4...); agora é o que
-- quem pede OFERECE, com um PISO pela faixa de peso. O `kind` continua na
-- linha (ele ainda governa expiração e prazo de confirmação, e o add-on de
-- entrega da vitrine da mig 249 continua abrindo chamados por ele).
--
-- ⚠️ AS FAIXAS SÃO TABELA, NÃO CONSTANTE: preço escrito no código é a
-- armadilha da mig 244 (tela de admin gravando num lugar que ninguém lia).
-- ⚠️ O PISO É CONGELADO NA LINHA (`min_price_cents`), pelo mesmo motivo do
-- preço da 248: mexer na tabela depois não pode mudar a regra de um chamado
-- que já está no ar.
-- =============================================================================

-- ─── 1. As faixas de peso ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_community_delivery_weight_band (
  band         VARCHAR(8)   PRIMARY KEY,
  label        VARCHAR(60)  NOT NULL,
  -- O menor valor que quem pede pode oferecer nesta faixa.
  min_cents    INT          NOT NULL CHECK (min_cents >= 0),
  -- Acima de 10 kg a faixa é NEGOCIADA: o vizinho pode fazer contraproposta.
  negotiable   BOOLEAN      NOT NULL DEFAULT FALSE,
  sort_order   INT          NOT NULL DEFAULT 0,
  is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_by   UUID         NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL
);

-- Seed fill-if-absent: re-rodar não desfaz o que o admin escolheu na tela.
INSERT INTO public.tb_community_delivery_weight_band
  (band, label, min_cents, negotiable, sort_order)
VALUES
  ('w1',   'Até 1 kg',        300, FALSE, 1),
  ('w3',   'De 1 a 3 kg',     500, FALSE, 2),
  ('w6',   'De 3 a 6 kg',    1500, FALSE, 3),
  ('w10',  'De 6 a 10 kg',   2000, FALSE, 4),
  ('w10p', 'Mais de 10 kg',  2000, TRUE,  5)
ON CONFLICT (band) DO NOTHING;

-- ─── 2. O chamado ganha direção, faixa e piso ────────────────────────────────
-- NULL = chamado antigo (tabela por tipo) ou add-on da vitrine. Nada é
-- reescrito: o histórico continua dizendo o que foi combinado na época.
ALTER TABLE public.tb_community_delivery_request
  ADD COLUMN IF NOT EXISTS direction       VARCHAR(8) NULL,
  ADD COLUMN IF NOT EXISTS weight_band     VARCHAR(8) NULL,
  ADD COLUMN IF NOT EXISTS min_price_cents INT        NULL,
  ADD COLUMN IF NOT EXISTS negotiable      BOOLEAN    NOT NULL DEFAULT FALSE;

-- `direction`: 'send' = quem pede ENVIA (o vizinho LEVA);
--              'receive' = quem pede RECEBE (o vizinho BUSCA e traz).
ALTER TABLE public.tb_community_delivery_request
  DROP CONSTRAINT IF EXISTS chk_delivery_direction;
ALTER TABLE public.tb_community_delivery_request
  ADD CONSTRAINT chk_delivery_direction
  CHECK (direction IS NULL OR direction IN ('send', 'receive'));

-- Sem FK para a tabela de faixas, pela mesma razão do `kind` na 248: desligar
-- uma faixa no admin não pode travar as corridas que já aconteceram nela.
ALTER TABLE public.tb_community_delivery_request
  DROP CONSTRAINT IF EXISTS chk_delivery_weight_band;
ALTER TABLE public.tb_community_delivery_request
  ADD CONSTRAINT chk_delivery_weight_band
  CHECK (weight_band IS NULL OR weight_band IN ('w1', 'w3', 'w6', 'w10', 'w10p'));

-- ─── 3. As contrapropostas ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_community_delivery_proposal (
  id_proposal  BIGSERIAL    PRIMARY KEY,
  id_delivery  BIGINT       NOT NULL
                 REFERENCES public.tb_community_delivery_request(id_delivery) ON DELETE CASCADE,
  id_courier   UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  -- Teto de R$ 1.000: conferência de digitação, como no admin da 248.
  amount_cents INT          NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 100000),
  note         VARCHAR(280) NULL,
  status       VARCHAR(12)  NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn')),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- UMA proposta viva por vizinho por chamado: propor de novo ATUALIZA o valor
-- (ON CONFLICT), em vez de empilhar cinco valores do mesmo vizinho na tela de
-- quem pediu.
CREATE UNIQUE INDEX IF NOT EXISTS ux_delivery_proposal_live
  ON public.tb_community_delivery_proposal (id_delivery, id_courier)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_delivery_proposal_delivery
  ON public.tb_community_delivery_proposal (id_delivery, created_at DESC);

-- ─── 4. O aviso de contraproposta ────────────────────────────────────────────
-- A lista INTEIRA de novo, com o MESMO nome (regra das migs 153/197/249/263).
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
    'delivery_proposal'
  )) NOT VALID;
