-- =============================================================================
-- Migration 136: Painel de Arquitetura — narração curada da função prática
-- =============================================================================
-- Cada função do inventário passa a ter uma DESCRIÇÃO em duas camadas (espelha o
-- padrão status/curated_status):
--   description           — narração automática gerada pelo scan (arch-scan.js),
--                           sempre atualizável no sync.
--   description_curated   — override escrito pelo admin no modal; vence sobre a
--                           automática e NUNCA é sobrescrito pelo scan.
-- A UI exibe COALESCE(description_curated, description) numa coluna no meio das
-- linhas e em destaque (fundo amarelo) no modal.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS.
-- =============================================================================

ALTER TABLE public.arch_functions
  ADD COLUMN IF NOT EXISTS description_curated TEXT;
