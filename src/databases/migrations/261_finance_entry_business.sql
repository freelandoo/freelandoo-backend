-- 261_finance_entry_business.sql
-- O LANÇAMENTO DA VIDA FINANCEIRA PODE SER "DO NEGÓCIO".
--
-- Pedido do Alex (2026-09-25): os Indicadores do negócio têm que trazer os
-- custos que a pessoa cadastra no Financeiro e mostrar receita × custo × lucro.
--
-- ⚠️ A VIDA FINANCEIRA É DA CONTA E É PESSOAL (mig 138): os presets são
-- "Salário", "Aluguel", "Streaming", "Faculdade". Somar tudo que está lá como
-- custo do negócio daria um lucro falso — o aluguel da casa descontado da
-- barbearia. Por isso o lançamento DECLARA de qual negócio é, e os Indicadores
-- leem só os que declararam. NULL = pessoal (o que todo lançamento era até hoje;
-- sem backfill, de propósito: adivinhar o negócio de um gasto antigo é inventar).
--
-- Mesma tabela, e não uma de "custos do negócio": o custo lançado pelos
-- Indicadores aparece na Vida Financeira e vice-versa. Duas tabelas seriam duas
-- verdades sobre o mesmo gasto.
--
-- SET NULL: apagar o negócio não pode apagar o registro de um dinheiro que saiu.
ALTER TABLE public.tb_wallet_finance_entry
  ADD COLUMN IF NOT EXISTS id_business_profile UUID NULL
  REFERENCES public.tb_profile(id_profile) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_wallet_fin_entry_business
  ON public.tb_wallet_finance_entry (id_business_profile)
  WHERE id_business_profile IS NOT NULL;
