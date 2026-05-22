-- =============================================================================
-- Migration 099: Pesos unificados — uma única fonte de pesos (xp_settings)
-- =============================================================================
-- O ranking e o XP já usam os mesmos pesos desde a mig 076 (a pontuação do
-- ranking é a soma dos subprofile_xp_events). Os pesos de ranking_config
-- (weight_*) estavam mortos. Esta migration:
--   1. Move o teto de tempo online para xp_settings (página única de pesos).
--   2. Remove os pesos mortos de ranking_config.
-- ranking_config passa a guardar só: estado da temporada + agendamento.

-- 1. Teto de minutos online passa a viver em xp_settings.
ALTER TABLE public.xp_settings
  ADD COLUMN IF NOT EXISTS max_online_minutes INT NOT NULL DEFAULT 120;

-- 2. Copia o teto atual de ranking_config — só na primeira execução, enquanto
--    a coluna ainda existir lá (depois do DROP abaixo, este bloco é pulado).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'ranking_config'
       AND column_name  = 'max_online_minutes'
  ) THEN
    UPDATE public.xp_settings xs
       SET max_online_minutes = rc.max_online_minutes
      FROM public.ranking_config rc
     WHERE xs.id = 1 AND rc.id = 1;
  END IF;
END $$;

-- 3. Remove os pesos mortos de ranking_config (a pontuação usa só xp_settings).
ALTER TABLE public.ranking_config
  DROP COLUMN IF EXISTS weight_visits,
  DROP COLUMN IF EXISTS weight_likes,
  DROP COLUMN IF EXISTS weight_ratings,
  DROP COLUMN IF EXISTS weight_online,
  DROP COLUMN IF EXISTS max_online_minutes;

COMMENT ON COLUMN public.xp_settings.max_online_minutes IS
  'Teto diário de minutos online que geram XP (anti-farm de aba aberta).';
