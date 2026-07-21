-- =============================================================================
-- Migration 188: CPF por usuário (Fase 1 — validação local, sem consulta externa)
-- =============================================================================
-- O CPF é do TITULAR, então mora em tb_user (fonte única). Todo perfil e
-- subperfil herda o vínculo pelo dono — não existe CPF por perfil, senão o
-- mesmo número seria copiado N vezes (e clan/comunidade não teria titular).
--
-- UNIQUE: 1 CPF = 1 conta. Quantos subperfis quiser DENTRO dela.
--
-- A coluna nasce NULLABLE de propósito: a base existente não tem CPF e o
-- preenchimento é forçado em runtime pelo gate de onboarding (modal
-- não-fechável), não por constraint — NOT NULL aqui derrubaria o boot.
--
-- Fase 1 valida apenas os dígitos verificadores (offline, grátis). A idade
-- continua vindo de tb_user.data_nascimento: o número do CPF NÃO carrega data
-- de nascimento (8 dígitos sequenciais + 1 de região fiscal + 2 verificadores).
-- Confirmar o par CPF↔nascimento exige consulta paga (Serpro/bureau) — Fase 2.
-- =============================================================================

ALTER TABLE public.tb_user
  ADD COLUMN IF NOT EXISTS cpf CHAR(11);

ALTER TABLE public.tb_user
  ADD COLUMN IF NOT EXISTS cpf_added_at TIMESTAMPTZ;

-- Só dígitos (a aplicação normaliza antes de gravar).
ALTER TABLE public.tb_user
  DROP CONSTRAINT IF EXISTS tb_user_cpf_digits_chk;
ALTER TABLE public.tb_user
  ADD CONSTRAINT tb_user_cpf_digits_chk
  CHECK (cpf IS NULL OR cpf ~ '^[0-9]{11}$');

-- 1 CPF = 1 conta. Parcial: NULLs da base antiga não colidem entre si.
CREATE UNIQUE INDEX IF NOT EXISTS ux_tb_user_cpf
  ON public.tb_user (cpf)
  WHERE cpf IS NOT NULL;
