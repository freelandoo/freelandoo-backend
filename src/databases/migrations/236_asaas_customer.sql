-- =============================================================================
-- Migration 236: o id do CLIENTE no Asaas passa a morar na conta
-- =============================================================================
-- POR QUE ISTO EXISTE
--
-- O Stripe aceita cobrar alguém que ele nunca viu: basta mandar `customer_email`
-- na Checkout Session. O ASAAS NÃO — `POST /v3/payments` exige `customer`, que é
-- o id de um cliente que já existe lá dentro, e criar esse cliente exige
-- `name` + `cpfCnpj` (conferido na doc, set/2026).
--
-- Sem guardar o id devolvido, toda cobrança criaria um cliente NOVO: a mesma
-- pessoa viraria dezenas de linhas no painel do Asaas, o histórico dela ficaria
-- picado entre elas e a cobrança recorrente perderia o fio. Guardar aqui torna
-- a criação do cliente um evento único por conta.
--
-- ⚠️ MORA EM tb_user, E NÃO EM tb_profile, porque quem paga é a PESSOA — é a
-- mesma decisão do CPF (mig 188), e é justamente o CPF que este id representa
-- do lado do Asaas. Pendurá-lo no perfil criaria um cliente por perfil, todos
-- com o MESMO CPF, e o Asaas recusa o segundo.
--
-- ⚠️ SEM BACKFILL e NULLABLE de propósito: ninguém tem cliente no Asaas ainda.
-- NULL significa "esta conta nunca pagou pelo Asaas" e é o que dispara a criação
-- sob demanda (get-or-create no AsaasCustomerService), não um estado de erro.

ALTER TABLE public.tb_user
  ADD COLUMN IF NOT EXISTS asaas_customer_id TEXT;

-- ⚠️ UNIQUE PARCIAL: o id do cliente é de UMA conta. Sem isto, um bug de
-- concorrência no get-or-create poderia apontar duas contas para o mesmo
-- cliente do Asaas — e aí a cobrança de uma pessoa apareceria na fatura da
-- outra. Parcial porque a esmagadora maioria das linhas é NULL, e um UNIQUE
-- cego recusaria a segunda conta sem cliente.
CREATE UNIQUE INDEX IF NOT EXISTS ux_tb_user_asaas_customer
  ON public.tb_user (asaas_customer_id)
  WHERE asaas_customer_id IS NOT NULL;
