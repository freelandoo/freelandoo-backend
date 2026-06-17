-- =============================================================================
-- Migration 165: Flag de tour de boas-vindas (mostrar 1x após o 1º acesso)
-- =============================================================================
-- O tour pós-cadastro (/bem-vindo) aparece automaticamente só na primeira
-- entrada do usuário (Google ou cadastro). Esta flag marca que ele já passou
-- (ou pulou) o tour, então não reabre sozinho. Reabrir é manual pelo menu.
-- Idempotente.
-- =============================================================================

ALTER TABLE public.tb_user
  ADD COLUMN IF NOT EXISTS onboarding_tour_done BOOLEAN NOT NULL DEFAULT FALSE;
