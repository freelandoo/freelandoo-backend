-- =============================================================================
-- Migration 326: dispensa temporária de CPF por ordem dos admins
-- =============================================================================
-- Conta provisória de cliente (site entregue antes de termos os dados dele)
-- precisa entrar sem cair no gate de identidade. A dispensa tem DATA DE FIM de
-- propósito: quando vence, o gate volta sozinho, sem job e sem ninguém lembrar.
--
-- Só adia o MODAL. Não vale como CPF: repasse, compra e tudo que exige titular
-- continuam olhando tb_user.cpf, e 1 CPF = 1 conta segue igual.
-- =============================================================================

ALTER TABLE public.tb_user
  ADD COLUMN IF NOT EXISTS cpf_waived_until TIMESTAMPTZ;

COMMENT ON COLUMN public.tb_user.cpf_waived_until IS
  'Até quando o gate de identidade (CPF e nascimento) fica dispensado por ordem dos admins. NULL = sem dispensa.';
