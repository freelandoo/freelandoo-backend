-- =============================================================================
-- Migration 138: Vida Financeira (controle manual de entradas/saídas na Wallet)
-- =============================================================================
-- Orçamento pessoal mensal do user (independente dos ganhos da plataforma).
-- Duas direções (in=entrada, out=saída) e duas recorrências:
--   recurring = "todo mês" (custo/receita fixa, entra automático em todo mês
--               a partir de start_ym) → tem due_day (dia do vencimento).
--   oneoff    = "hoje" (variável) → tem entry_date (data do lançamento).
-- Idempotente. Categorias preset (user_id NULL) são semeadas aqui.
-- =============================================================================

-- Categorias (presets globais com user_id NULL + customizadas por user) -------
CREATE TABLE IF NOT EXISTS public.tb_wallet_finance_category (
  id          BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     UUID         REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  direction   VARCHAR(3)   NOT NULL CHECK (direction IN ('in', 'out')),
  recurrence  VARCHAR(9)   NOT NULL CHECK (recurrence IN ('recurring', 'oneoff')),
  label       VARCHAR(60)  NOT NULL,
  is_default  BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- UNIQUE tratando user_id NULL (preset) como um valor fixo, pra o seed ser
-- idempotente e pra não duplicar categoria por user.
CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_fin_cat
  ON public.tb_wallet_finance_category
     (COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid), direction, recurrence, label);

-- Lançamentos -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tb_wallet_finance_entry (
  id            BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  direction     VARCHAR(3)   NOT NULL CHECK (direction IN ('in', 'out')),
  recurrence    VARCHAR(9)   NOT NULL CHECK (recurrence IN ('recurring', 'oneoff')),
  title         VARCHAR(120) NOT NULL,
  category      VARCHAR(60),
  amount_cents  BIGINT       NOT NULL CHECK (amount_cents >= 0),
  entry_date    DATE,                          -- oneoff: data do lançamento
  due_day       SMALLINT     CHECK (due_day BETWEEN 1 AND 31), -- recurring: dia
  start_ym      INTEGER,                        -- recurring: YYYYMM inicial
  active        BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_fin_entry_user_date
  ON public.tb_wallet_finance_entry (user_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_wallet_fin_entry_user_recurring
  ON public.tb_wallet_finance_entry (user_id, recurrence, active);

-- Seed de categorias preset (BR). Idempotente via ON CONFLICT no índice acima.
INSERT INTO public.tb_wallet_finance_category (user_id, direction, recurrence, label, is_default)
VALUES
  -- Entradas recorrentes (recebo todo mês)
  (NULL, 'in', 'recurring', 'Salário', TRUE),
  (NULL, 'in', 'recurring', 'Pró-labore', TRUE),
  (NULL, 'in', 'recurring', 'Aposentadoria', TRUE),
  (NULL, 'in', 'recurring', 'Pensão', TRUE),
  (NULL, 'in', 'recurring', 'Aluguel recebido', TRUE),
  (NULL, 'in', 'recurring', 'Renda de investimentos', TRUE),
  (NULL, 'in', 'recurring', 'Mesada', TRUE),
  (NULL, 'in', 'recurring', 'Bolsa / Auxílio', TRUE),
  -- Entradas variáveis (recebi hoje)
  (NULL, 'in', 'oneoff', 'Vendas', TRUE),
  (NULL, 'in', 'oneoff', 'Freelance', TRUE),
  (NULL, 'in', 'oneoff', 'Comissão', TRUE),
  (NULL, 'in', 'oneoff', 'Presente', TRUE),
  (NULL, 'in', 'oneoff', 'Reembolso', TRUE),
  (NULL, 'in', 'oneoff', 'Cashback', TRUE),
  (NULL, 'in', 'oneoff', 'Prêmio', TRUE),
  (NULL, 'in', 'oneoff', 'Outras receitas', TRUE),
  -- Saídas recorrentes (gasto todo mês)
  (NULL, 'out', 'recurring', 'Aluguel', TRUE),
  (NULL, 'out', 'recurring', 'Condomínio', TRUE),
  (NULL, 'out', 'recurring', 'Água', TRUE),
  (NULL, 'out', 'recurring', 'Luz', TRUE),
  (NULL, 'out', 'recurring', 'Internet', TRUE),
  (NULL, 'out', 'recurring', 'Telefone', TRUE),
  (NULL, 'out', 'recurring', 'Streaming', TRUE),
  (NULL, 'out', 'recurring', 'Faculdade / Escola', TRUE),
  (NULL, 'out', 'recurring', 'Plano de saúde', TRUE),
  (NULL, 'out', 'recurring', 'Academia', TRUE),
  (NULL, 'out', 'recurring', 'Cartão de crédito', TRUE),
  (NULL, 'out', 'recurring', 'Financiamento', TRUE),
  (NULL, 'out', 'recurring', 'Seguro', TRUE),
  (NULL, 'out', 'recurring', 'Transporte', TRUE),
  (NULL, 'out', 'recurring', 'Matéria-prima', TRUE),
  (NULL, 'out', 'recurring', 'Colaboradores', TRUE),
  (NULL, 'out', 'recurring', 'Fornecedores', TRUE),
  -- Saídas variáveis (gastei hoje)
  (NULL, 'out', 'oneoff', 'Mercado', TRUE),
  (NULL, 'out', 'oneoff', 'Padaria', TRUE),
  (NULL, 'out', 'oneoff', 'Bar / Restaurante', TRUE),
  (NULL, 'out', 'oneoff', 'Transporte', TRUE),
  (NULL, 'out', 'oneoff', 'Farmácia', TRUE),
  (NULL, 'out', 'oneoff', 'Lazer', TRUE),
  (NULL, 'out', 'oneoff', 'Roupas', TRUE),
  (NULL, 'out', 'oneoff', 'Presentes', TRUE),
  (NULL, 'out', 'oneoff', 'Pet', TRUE),
  (NULL, 'out', 'oneoff', 'Imprevistos', TRUE)
ON CONFLICT (COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid), direction, recurrence, label)
DO NOTHING;
