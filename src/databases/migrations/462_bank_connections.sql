-- =============================================================================
-- Migration 462: BANCOS CONECTADOS NA CARTEIRA (Open Finance pela Malvo)
-- =============================================================================
-- Decisão do Alex (2026-11-21): a pessoa conecta até 2 bancos e o saldo, o
-- extrato e a fatura do cartão entram na Vida Financeira (mig 138). R$ 20/mês.
-- Plano: docs/PLANO_CARTEIRA_OPEN_FINANCE.md.
--
-- ─── POR QUE A MALVO E O QUE ELA COBRA ─────────────────────────────────────
-- A Malvo (malvo.io) é só leitura (sem Pix) e cobra R$ 4,00 por "1 nova conexão
-- no mês ou 1 item existente atualizado no mês". Duas consequências moldam as
-- tabelas abaixo:
--   • RECONECTAR É COBRADO: cada conexão nova/reconsentimento fica registrada
--     em `tb_bank_connect_event`, e o limite mensal é contado nela.
--   • ITEM QUE NÃO SINCRONIZA NO MÊS NÃO CUSTA: `auto_sync_paused` marca quem
--     teve o auto-sync desligado (assinatura vencida ou conta parada).
--
-- ─── A ASSINATURA É A MECÂNICA DO SELO (mig 268), COPIADA ──────────────────
-- Cartão = assinatura de verdade (cada fatura empurra `paid_until` um mês);
-- Pix = compra UM mês. Não entra pelos Planos (mig 225) porque lá só cabe UM
-- plano vivo por pessoa (`ux_user_plan_active`): quem tem o Plano Negócio não
-- poderia assinar os bancos.
--
-- ─── O QUE NÃO GUARDAMOS ───────────────────────────────────────────────────
-- Nenhuma credencial do banco: o usuário autoriza no app do banco e a Malvo
-- devolve só um id (Item). O `clientUserId` mandado à Malvo é o id_user (UUID
-- opaco), nunca e-mail ou CPF.
--
-- Idempotente. (O runner envolve cada migration em transação própria.)
-- =============================================================================

-- ─── 1. A régua da venda (linha única) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_bank_access_settings (
  id                   INT         PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  monthly_cents        INT         NOT NULL DEFAULT 2000 CHECK (monthly_cents >= 0),
  max_banks            SMALLINT    NOT NULL DEFAULT 2 CHECK (max_banks BETWEEN 1 AND 10),
  -- Conexões NOVAS (inclui reconectar) que cabem num mês. Duas para os dois
  -- bancos + uma troca: cada uma custa R$ 4 na Malvo.
  connects_per_month   SMALLINT    NOT NULL DEFAULT 3 CHECK (connects_per_month BETWEEN 1 AND 20),
  is_active            BOOLEAN     NOT NULL DEFAULT TRUE,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by           UUID        NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL
);
INSERT INTO public.tb_bank_access_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ─── 2. Quem pode conectar (o período pago) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_user_bank_access (
  id_user               UUID        PRIMARY KEY REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  paid_until            TIMESTAMPTZ NULL,
  subscription_ref      TEXT        NULL,
  subscription_provider VARCHAR(16) NULL,
  subscription_status   VARCHAR(16) NULL
                          CHECK (subscription_status IS NULL
                                 OR subscription_status IN ('active', 'past_due', 'canceled')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_user_bank_access_sub
  ON public.tb_user_bank_access (subscription_ref)
  WHERE subscription_ref IS NOT NULL;
-- O sweeper procura quem VENCEU (para pausar o auto-sync e, depois da carência,
-- desconectar): poucas linhas numa tabela que só cresce.
CREATE INDEX IF NOT EXISTS ix_user_bank_access_paid_until
  ON public.tb_user_bank_access (paid_until)
  WHERE paid_until IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.tb_bank_access_payment (
  id_payment        BIGSERIAL   PRIMARY KEY,
  id_user           UUID        NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  method            VARCHAR(8)  NOT NULL CHECK (method IN ('card', 'pix', 'renewal')),
  payment_provider  VARCHAR(16) NULL,
  amount_cents      INT         NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  status            VARCHAR(12) NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'paid', 'canceled', 'refunded')),
  stripe_session_id TEXT        NULL,
  payment_intent_id TEXT        NULL,
  invoice_ref       TEXT        NULL,
  period_start      TIMESTAMPTZ NULL,
  period_end        TIMESTAMPTZ NULL,
  paid_at           TIMESTAMPTZ NULL,
  refunded_at       TIMESTAMPTZ NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_access_payment_session
  ON public.tb_bank_access_payment (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;
-- ⚠️ O webhook é at-least-once: sem este UNIQUE cada reentrega da fatura
-- empurraria o acesso mais um mês de graça.
CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_access_payment_invoice
  ON public.tb_bank_access_payment (invoice_ref)
  WHERE invoice_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_bank_access_payment_pi
  ON public.tb_bank_access_payment (payment_intent_id)
  WHERE payment_intent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_bank_access_payment_user
  ON public.tb_bank_access_payment (id_user, created_at DESC);

-- ─── 3. As conexões (1 linha = 1 Item da Malvo = 1 banco de 1 pessoa) ───────
CREATE TABLE IF NOT EXISTS public.tb_bank_connection (
  id_connection      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user            UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  malvo_item_id      TEXT         NOT NULL,
  connector_id       INT          NULL,
  institution_name   VARCHAR(120) NULL,
  institution_logo   TEXT         NULL,
  primary_color      VARCHAR(8)   NULL,
  is_sandbox         BOOLEAN      NOT NULL DEFAULT FALSE,
  -- Espelho do Item (status/executionStatus da Malvo). `needs_action` é o que
  -- a tela lê: verdadeiro = mostrar "Reconectar".
  status             VARCHAR(32)  NULL,
  execution_status   VARCHAR(48)  NULL,
  needs_action       BOOLEAN      NOT NULL DEFAULT FALSE,
  consent_expires_at TIMESTAMPTZ  NULL,
  last_synced_at     TIMESTAMPTZ  NULL,
  -- Último dia já importado para a Vida Financeira (cursor da sincronização).
  synced_through     DATE         NULL,
  auto_sync_paused   BOOLEAN      NOT NULL DEFAULT FALSE,
  -- Última vez que o dono abriu os bancos na Carteira. Parado há 30 dias, o
  -- auto-sync é pausado (item sem sync no mês não custa) e volta quando ele abre.
  viewed_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ  NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_connection_item
  ON public.tb_bank_connection (malvo_item_id);
CREATE INDEX IF NOT EXISTS ix_bank_connection_user
  ON public.tb_bank_connection (id_user)
  WHERE deleted_at IS NULL;

-- As contas de cada conexão (corrente, poupança, cartão). O saldo e a fatura
-- aberta ficam aqui; os lançamentos vão para a Vida Financeira.
CREATE TABLE IF NOT EXISTS public.tb_bank_account (
  id_account          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_connection       UUID         NOT NULL REFERENCES public.tb_bank_connection(id_connection) ON DELETE CASCADE,
  id_user             UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  malvo_account_id    TEXT         NOT NULL,
  type                VARCHAR(16)  NULL,   -- BANK | CREDIT
  subtype             VARCHAR(32)  NULL,   -- CHECKING_ACCOUNT | SAVINGS_ACCOUNT | CREDIT_CARD
  name                VARCHAR(160) NULL,
  number_tail         VARCHAR(8)   NULL,   -- só os últimos dígitos, nunca o número inteiro
  currency            VARCHAR(3)   NOT NULL DEFAULT 'BRL',
  balance_cents       BIGINT       NULL,
  credit_limit_cents  BIGINT       NULL,
  bill_amount_cents   BIGINT       NULL,
  bill_due_date       DATE         NULL,
  balance_at          TIMESTAMPTZ  NULL,
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_account_malvo
  ON public.tb_bank_account (malvo_account_id);
CREATE INDEX IF NOT EXISTS ix_bank_account_connection
  ON public.tb_bank_account (id_connection);

-- Toda conexão NOVA (ou reconsentimento) que a Malvo cobra. O limite mensal é
-- contado aqui, e não nas conexões vivas: desconectar e conectar de novo é
-- exatamente o caso que custa.
CREATE TABLE IF NOT EXISTS public.tb_bank_connect_event (
  id_event    BIGSERIAL   PRIMARY KEY,
  id_user     UUID        NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  kind        VARCHAR(12) NOT NULL CHECK (kind IN ('connect', 'reconnect')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_bank_connect_event_user
  ON public.tb_bank_connect_event (id_user, created_at DESC);

-- Idempotência do webhook: a Malvo reentrega com o MESMO eventId.
CREATE TABLE IF NOT EXISTS public.tb_bank_webhook_event (
  event_id     TEXT        PRIMARY KEY,
  event        VARCHAR(48) NOT NULL,
  item_id      TEXT        NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_bank_webhook_event_received
  ON public.tb_bank_webhook_event (received_at);

-- ─── 4. A Vida Financeira passa a saber de onde veio cada lançamento ────────
-- manual = digitado (o que todo lançamento era até hoje)
-- bank   = veio do banco conectado (valor não se edita; apagar não vale — a
--          próxima sincronização traria de volta)
-- ofx    = importado de extrato OFX/CSV (grátis)
ALTER TABLE public.tb_wallet_finance_entry
  ADD COLUMN IF NOT EXISTS source VARCHAR(8) NOT NULL DEFAULT 'manual';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_wallet_fin_entry_source') THEN
    ALTER TABLE public.tb_wallet_finance_entry
      ADD CONSTRAINT chk_wallet_fin_entry_source CHECK (source IN ('manual', 'bank', 'ofx'));
  END IF;
END $$;
ALTER TABLE public.tb_wallet_finance_entry
  ADD COLUMN IF NOT EXISTS external_id TEXT NULL;
ALTER TABLE public.tb_wallet_finance_entry
  ADD COLUMN IF NOT EXISTS id_bank_account UUID NULL
  REFERENCES public.tb_bank_account(id_account) ON DELETE SET NULL;
-- A mesma transação nunca entra duas vezes para a mesma pessoa (sincronização
-- repetida, OFX importado de novo).
CREATE UNIQUE INDEX IF NOT EXISTS ux_wallet_fin_entry_external
  ON public.tb_wallet_finance_entry (user_id, source, external_id)
  WHERE external_id IS NOT NULL;

-- ─── 5. Chave de liga/desliga (Painel de Controle) ─────────────────────────
-- Nasce DESLIGADA: até a Malvo confirmar a parceria na Resolução Conjunta 21
-- (lista ao BC até 01/12/2026), só administradores conectam — eles têm acesso
-- pelo PAPEL, como no selo.
INSERT INTO public.tb_feature_flag (flag_key, is_enabled, label, description)
VALUES (
  'bancos_conectados', FALSE, 'Bancos conectados (Open Finance)',
  'Venda e conexão de bancos na Carteira (R$20/mês, até 2 bancos, pela Malvo). Desligada, só administradores conectam; quem já conectou continua vendo os dados.'
)
ON CONFLICT (flag_key) DO NOTHING;
