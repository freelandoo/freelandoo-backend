-- =============================================================================
-- Migration 113: Casa Views — visibilidade por seção do dossiê
-- =============================================================================
-- O admin edita o participante na própria página e pode ligar/desligar cada
-- bloco (perfil, jornada, segredos, teorias, desempenho, cofre, suspeita,
-- capturas, loja). O público só vê as seções com show_* = TRUE.
-- Idempotente.
-- =============================================================================

ALTER TABLE public.casa_participant
  ADD COLUMN IF NOT EXISTS show_perfil     BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS show_journey    BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS show_secrets    BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS show_theories   BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS show_desempenho BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS show_cofre      BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS show_suspicion  BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS show_captures   BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS show_store      BOOLEAN NOT NULL DEFAULT TRUE;
