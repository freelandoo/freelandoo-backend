-- =============================================================================
-- Migration 095: user_tour_progress.seen_version
-- =============================================================================
-- Guarda qual versão do tour o usuário viu. Quando o config do tour sobe de
-- versão (steps novos), o front compara seen_version < version e reexibe o
-- tour automaticamente mesmo para quem já tinha concluído.
-- =============================================================================

ALTER TABLE public.user_tour_progress
  ADD COLUMN IF NOT EXISTS seen_version INT NOT NULL DEFAULT 1;
