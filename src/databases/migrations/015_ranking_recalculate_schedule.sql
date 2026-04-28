-- =============================================================================
-- Migration 015: Agendamento de recálculo do ranking + ajustes de defaults
-- =============================================================================

-- Coluna pra controlar último recálculo automático
ALTER TABLE public.ranking_config
  ADD COLUMN IF NOT EXISTS last_recalculated_at TIMESTAMPTZ NULL;

-- Ajusta defaults para "2 pontos por minuto, máx 60 min/dia = 120 pts/dia"
-- (apenas se ainda estão nos defaults antigos — não sobrescreve customização do admin)
UPDATE public.ranking_config
   SET weight_online       = 2,
       max_online_minutes  = 60
 WHERE id = 1
   AND weight_online       = 0.5
   AND max_online_minutes  = 120;
