-- =============================================================================
-- Migration 112: Casa Views — campos do "Perfil Narrativo" do participante
-- =============================================================================
-- A página do participante (dossiê estilo "LIA MENDES") tem um bloco "Perfil
-- Narrativo" com 4 linhas: Profissão, Arquétipo, Força, Risco. Editorial (admin).
-- Idempotente.
-- =============================================================================

ALTER TABLE public.casa_participant
  ADD COLUMN IF NOT EXISTS profession VARCHAR(120),
  ADD COLUMN IF NOT EXISTS archetype  VARCHAR(120),
  ADD COLUMN IF NOT EXISTS strengths  VARCHAR(300),  -- "Leitura | Controle | Resiliência"
  ADD COLUMN IF NOT EXISTS risks      VARCHAR(300);  -- "Frieza | Isolamento | Cálculo"
