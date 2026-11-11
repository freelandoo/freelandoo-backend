-- 449 — MEU MUNDO 3D, trilha E, fatia E12: o Domínio como masmorra.
--
-- Bônus da PRIMEIRA vitória de uma tabela de saque (`domain:floresta:7` dá o projeto da Vigília,
-- `domain:<id>:10` dá 10 fragmentos e a receita da arma de linha). Uma linha por conta × tabela:
-- o INSERT ... ON CONFLICT DO NOTHING dentro da transação do recibo decide quem é a primeira (a
-- luta que gravou fica em `id_fight`). Por conta, como o progresso dos Domínios
-- (tb_mm_domain_progress). Quem já tinha vencido o setor antes da E12 recebe o bônus na próxima
-- vitória (nunca recebeu). Regra em utils/mmItems/catalog/loot.js. Idempotente.

CREATE TABLE IF NOT EXISTS public.tb_mm_loot_first (
  id_user UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  loot_table TEXT NOT NULL,
  id_fight UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_user, loot_table)
);
