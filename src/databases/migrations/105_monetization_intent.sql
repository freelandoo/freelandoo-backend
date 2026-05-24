-- =============================================================================
-- Migration 105: Monetization Intent — modal "primeira visita"
-- =============================================================================
-- Reaproveita as tabelas tour_monetization_paths e
-- user_onboarding_monetization_state (criadas na mig 103, rodada antes do
-- revert da feature de tours). Adiciona:
--   - video_url      → vídeo tutorial por caminho (TELA INTEIRA ao clicar)
--   - poster_url     → thumbnail/poster opcional do vídeo
--   - accent_color   → cor do CTA (amber/violet/emerald/sky/...)
--
-- Idempotente: ADD COLUMN IF NOT EXISTS + UPDATE com guard.

ALTER TABLE public.tour_monetization_paths
  ADD COLUMN IF NOT EXISTS video_url    TEXT NULL,
  ADD COLUMN IF NOT EXISTS poster_url   TEXT NULL,
  ADD COLUMN IF NOT EXISTS accent_color TEXT NULL;

-- Cor padrão por path_key, só onde ainda está NULL (não sobrescreve admin).
UPDATE public.tour_monetization_paths
   SET accent_color = CASE path_key
         WHEN 'affiliate' THEN 'amber'
         WHEN 'courses'   THEN 'violet'
         WHEN 'products'  THEN 'emerald'
         WHEN 'services'  THEN 'sky'
         WHEN 'explore'   THEN 'amber'
         ELSE 'amber'
       END,
       updated_at = NOW()
 WHERE accent_color IS NULL
   AND path_key IN ('affiliate','courses','products','services','explore');
