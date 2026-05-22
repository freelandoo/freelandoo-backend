-- =============================================================================
-- Migration 015: Agendamento de recálculo do ranking + ajustes de defaults
-- =============================================================================

-- Coluna pra controlar último recálculo automático
ALTER TABLE public.ranking_config
  ADD COLUMN IF NOT EXISTS last_recalculated_at TIMESTAMPTZ NULL;

-- Ajusta defaults para "2 pontos por minuto, máx 60 min/dia = 120 pts/dia"
-- (apenas se ainda estão nos defaults antigos — não sobrescreve customização do admin)
-- Guard: a mig 099 removeu weight_online/max_online_minutes de ranking_config;
-- este UPDATE só roda enquanto as colunas existirem (não derruba boots futuros).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'ranking_config'
       AND column_name  = 'weight_online'
  ) THEN
    UPDATE public.ranking_config
       SET weight_online      = 2,
           max_online_minutes = 60
     WHERE id = 1
       AND weight_online      = 0.5
       AND max_online_minutes = 120;
  END IF;
END $$;
