-- =============================================================================
-- Migration 094: coluna course_mural_last_seen_at em tb_profile
-- =============================================================================
-- Espelha tb_profile.mural_last_seen_at (mig 023), mas para o mural de cursos.
-- Permite contar "pedidos de curso novos desde a última visita" no badge.
-- =============================================================================

ALTER TABLE public.tb_profile
  ADD COLUMN IF NOT EXISTS course_mural_last_seen_at TIMESTAMPTZ;
