-- =============================================================================
-- Migration 277: CONTABILIDADE DOS ADMINS — livro caixa, guias e obrigações
-- =============================================================================
-- Pedido do Alex (2026-10-09): "faça dentro da freelandoo um sistema de admins"
-- para cuidar da contabilidade da própria empresa (ME no Simples, quase sem
-- movimento) depois de descobrir guias vencidas (TFE + DARF unificado) que a
-- contabilidade gerava sem ele entender de onde vinham.
--
-- É um painel INTERNO (papel Administrator). Ele não transmite nada a órgão
-- nenhum: organiza, calcula e lembra. A transmissão continua sendo feita nos
-- portais oficiais (PGDAS-D, e-CAC, prefeitura) — o comprovante volta para cá.
--
-- Quatro tabelas:
--   tb_acct_company     as empresas que os admins acompanham (multi de
--                       propósito: o mesmo painel serve mais de um CNPJ)
--   tb_acct_entry       o LIVRO CAIXA (a ME do Simples pode escriturar só ele,
--                       LC 123 art. 26 §2º) — receita, despesa, pró-labore…
--   tb_acct_obligation  guias a pagar E declarações a entregar, com status,
--                       valor pago e comprovante (R2 privado, URL assinada)
--   tb_acct_selic       Selic mensal cadastrada pelo admin, usada na conta de
--                       juros de guia vencida (mês sem linha = estimativa)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_acct_company (
  id_company      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(160) NOT NULL,
  cnpj            CHAR(14),
  regime          VARCHAR(16) NOT NULL DEFAULT 'simples',
  simples_anexo   VARCHAR(8),
  municipio       VARCHAR(120),
  uf              CHAR(2),
  notes           TEXT,
  created_by      UUID REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

ALTER TABLE public.tb_acct_company DROP CONSTRAINT IF EXISTS chk_acct_company_regime;
ALTER TABLE public.tb_acct_company ADD CONSTRAINT chk_acct_company_regime
  CHECK (regime IN ('mei', 'simples', 'presumido', 'real'));

-- Espelho de SIMPLES_ANEXOS (src/utils/accountingTax.js).
ALTER TABLE public.tb_acct_company DROP CONSTRAINT IF EXISTS chk_acct_company_anexo;
ALTER TABLE public.tb_acct_company ADD CONSTRAINT chk_acct_company_anexo
  CHECK (simples_anexo IS NULL OR simples_anexo IN ('I', 'II', 'III', 'IV', 'V', 'III_V'));

ALTER TABLE public.tb_acct_company DROP CONSTRAINT IF EXISTS chk_acct_company_cnpj;
ALTER TABLE public.tb_acct_company ADD CONSTRAINT chk_acct_company_cnpj
  CHECK (cnpj IS NULL OR cnpj ~ '^[0-9]{14}$');

-- ─── Livro caixa ─────────────────────────────────────────────────────────────
-- `entry_type` decide a direção E o papel na conta do DAS:
--   revenue    entrada que é FATURAMENTO (base do DAS e da RBT12)
--   other_in   entrada que não é faturamento (aporte, empréstimo, reembolso)
--   expense    despesa operacional
--   prolabore  retirada do sócio (entra na folha do Fator R)
--   payroll    salário e encargos de funcionário (idem)
--   tax        imposto pago (para o caixa bater; não é despesa dedutível no Simples)
--   other_out  saída que não é despesa (distribuição de lucro, transferência)
CREATE TABLE IF NOT EXISTS public.tb_acct_entry (
  id_entry        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_company      UUID NOT NULL REFERENCES public.tb_acct_company(id_company) ON DELETE CASCADE,
  entry_date      DATE NOT NULL,
  entry_type      VARCHAR(16) NOT NULL,
  amount_cents    BIGINT NOT NULL,
  description     VARCHAR(240) NOT NULL,
  counterparty    VARCHAR(160),
  document_ref    VARCHAR(80),
  id_obligation   UUID,
  created_by      UUID REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.tb_acct_entry DROP CONSTRAINT IF EXISTS chk_acct_entry_type;
ALTER TABLE public.tb_acct_entry ADD CONSTRAINT chk_acct_entry_type
  CHECK (entry_type IN ('revenue', 'other_in', 'expense', 'prolabore', 'payroll', 'tax', 'other_out'));

-- Valor sempre positivo: a DIREÇÃO é do tipo, não do sinal. Dois jeitos de
-- dizer "saída" (tipo de saída OU valor negativo) dariam saldo errado na
-- primeira linha que usasse os dois.
ALTER TABLE public.tb_acct_entry DROP CONSTRAINT IF EXISTS chk_acct_entry_amount;
ALTER TABLE public.tb_acct_entry ADD CONSTRAINT chk_acct_entry_amount
  CHECK (amount_cents > 0);

CREATE INDEX IF NOT EXISTS ix_acct_entry_company_date
  ON public.tb_acct_entry (id_company, entry_date DESC);

-- ─── Guias e obrigações ──────────────────────────────────────────────────────
-- kind:
--   payment      guia a pagar (DAS, DARF, TFE, IPTU, ISS…) — tem valor
--   declaration  entrega sem pagamento (DEFIS, DCTFWeb sem movimento, PGDAS-D
--                zerado, DASN-SIMEI) — valor NULL
-- status:
--   pending   ainda não resolvida (vencida ou não — "vencida" é derivado da data)
--   paid      guia paga
--   filed     declaração entregue
--   canceled  não era devida / substituída por guia recalculada
CREATE TABLE IF NOT EXISTS public.tb_acct_obligation (
  id_obligation      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_company         UUID NOT NULL REFERENCES public.tb_acct_company(id_company) ON DELETE CASCADE,
  kind               VARCHAR(16) NOT NULL DEFAULT 'payment',
  name               VARCHAR(120) NOT NULL,
  sphere             VARCHAR(16) NOT NULL DEFAULT 'federal',
  competence         DATE,
  due_date           DATE NOT NULL,
  amount_cents       BIGINT,
  status             VARCHAR(16) NOT NULL DEFAULT 'pending',
  paid_at            DATE,
  paid_amount_cents  BIGINT,
  receipt_key        VARCHAR(300),
  receipt_mime       VARCHAR(80),
  notes              TEXT,
  source             VARCHAR(16) NOT NULL DEFAULT 'manual',
  created_by         UUID REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.tb_acct_obligation DROP CONSTRAINT IF EXISTS chk_acct_obligation_kind;
ALTER TABLE public.tb_acct_obligation ADD CONSTRAINT chk_acct_obligation_kind
  CHECK (kind IN ('payment', 'declaration'));

ALTER TABLE public.tb_acct_obligation DROP CONSTRAINT IF EXISTS chk_acct_obligation_sphere;
ALTER TABLE public.tb_acct_obligation ADD CONSTRAINT chk_acct_obligation_sphere
  CHECK (sphere IN ('federal', 'estadual', 'municipal'));

ALTER TABLE public.tb_acct_obligation DROP CONSTRAINT IF EXISTS chk_acct_obligation_status;
ALTER TABLE public.tb_acct_obligation ADD CONSTRAINT chk_acct_obligation_status
  CHECK (status IN ('pending', 'paid', 'filed', 'canceled'));

ALTER TABLE public.tb_acct_obligation DROP CONSTRAINT IF EXISTS chk_acct_obligation_source;
ALTER TABLE public.tb_acct_obligation ADD CONSTRAINT chk_acct_obligation_source
  CHECK (source IN ('manual', 'generated'));

ALTER TABLE public.tb_acct_obligation DROP CONSTRAINT IF EXISTS chk_acct_obligation_amount;
ALTER TABLE public.tb_acct_obligation ADD CONSTRAINT chk_acct_obligation_amount
  CHECK (amount_cents IS NULL OR amount_cents >= 0);

CREATE INDEX IF NOT EXISTS ix_acct_obligation_company_due
  ON public.tb_acct_obligation (id_company, due_date);

-- O gerador do calendário roda quantas vezes o admin quiser: a mesma
-- obrigação gerada (empresa, nome, competência) só nasce UMA vez. Parcial em
-- `generated` porque a guia manual pode repetir nome e mês legitimamente
-- (a guia original e a recalculada, por exemplo).
CREATE UNIQUE INDEX IF NOT EXISTS ux_acct_obligation_generated
  ON public.tb_acct_obligation (id_company, name, competence)
  WHERE source = 'generated';

-- O lançamento do caixa pode apontar a guia que ele pagou. FK depois das duas
-- tabelas existirem; SET NULL porque apagar a guia não apaga o dinheiro que saiu.
ALTER TABLE public.tb_acct_entry DROP CONSTRAINT IF EXISTS fk_acct_entry_obligation;
ALTER TABLE public.tb_acct_entry ADD CONSTRAINT fk_acct_entry_obligation
  FOREIGN KEY (id_obligation) REFERENCES public.tb_acct_obligation(id_obligation) ON DELETE SET NULL;

-- ─── Selic mensal ────────────────────────────────────────────────────────────
-- `rate` em fração decimal (0.0115 = 1,15% no mês). Global: a Selic é a mesma
-- para todas as empresas. Sem seed: um número digitado aqui sem fonte seria
-- apresentado como "cadastrado" e esconderia a marca de estimativa.
CREATE TABLE IF NOT EXISTS public.tb_acct_selic (
  month       DATE PRIMARY KEY,
  rate        NUMERIC(8, 6) NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.tb_acct_selic DROP CONSTRAINT IF EXISTS chk_acct_selic_rate;
ALTER TABLE public.tb_acct_selic ADD CONSTRAINT chk_acct_selic_rate
  CHECK (rate >= 0 AND rate < 1);

ALTER TABLE public.tb_acct_selic DROP CONSTRAINT IF EXISTS chk_acct_selic_month;
ALTER TABLE public.tb_acct_selic ADD CONSTRAINT chk_acct_selic_month
  CHECK (EXTRACT(DAY FROM month) = 1);
