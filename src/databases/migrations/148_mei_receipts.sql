-- 148_mei_receipts.sql
-- Camada MEI/Recibo da Carteira (v1): perfil fiscal do prestador + recibos
-- emitidos. O acompanhamento do teto MEI (R$ 81k/ano) NÃO precisa de tabela —
-- é agregado on-the-fly a partir das mesmas fontes de faturamento do extrato
-- (tb_seller_balance / tb_booking_payout / course_enrollments /
-- tb_affiliate_conversion). Aqui guardamos só os DADOS do prestador (pro recibo)
-- e os recibos emitidos (numeração sequencial por usuário).
-- Idempotente.

CREATE TABLE IF NOT EXISTS public.mei_profile (
  id_user          UUID PRIMARY KEY REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  is_mei           BOOLEAN NOT NULL DEFAULT FALSE,
  cnpj             VARCHAR(20),
  provider_name    VARCHAR(160),   -- nome/razão do prestador (default = tb_user.nome)
  provider_doc     VARCHAR(20),    -- CPF do prestador
  provider_address TEXT,
  das_reminder     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.mei_receipt (
  id_receipt   BIGSERIAL PRIMARY KEY,
  id_user      UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  number       INTEGER NOT NULL,         -- sequencial por usuário (1,2,3...)
  taker_name   VARCHAR(160) NOT NULL,    -- tomador (cliente)
  taker_doc    VARCHAR(30),
  description  TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  issued_for   DATE,                     -- data/competência do serviço
  source_kind  VARCHAR(20) NOT NULL DEFAULT 'manual', -- service|product|course|affiliate|manual
  source_id    VARCHAR(80),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_mei_receipt_user_number
  ON public.mei_receipt (id_user, number);
CREATE INDEX IF NOT EXISTS ix_mei_receipt_user_created
  ON public.mei_receipt (id_user, created_at DESC);
