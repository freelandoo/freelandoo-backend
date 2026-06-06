-- =============================================================================
-- Migration 122: Mapeia cidades já existentes no sistema (fora do seed 121) pra
-- a região mais próxima, e re-aplica o backfill em tb_profile.
-- =============================================================================
-- A mig 121 seedou só cidades-exemplo. Perfis em cidades fora dessa lista
-- ficaram com id_region NULL. Levantamento na base de produção (2026-06-06)
-- achou 2 cidades não mapeadas; cada uma vai pra região vizinha correta:
--   - Rio Formoso/PE  → "Zona da Mata e Litoral" (litoral sul, vizinha de
--                        Sirinhaém/Palmares já no seed).
--   - Assunção do Piauí/PI → "Teresina e Norte do Piauí" (mesorregião Norte
--                        Piauiense / microrregião de Campo Maior).
-- Idempotente: ON CONFLICT + UPDATE só onde diverge. Novas cidades não mapeadas
-- que surgirem depois precisam de tratamento similar (seed ou ferramenta admin).
-- =============================================================================

INSERT INTO public.tb_region_city (id_region, uf, municipio_norm)
SELECT r.id_region, v.uf, fl_norm_city(v.city)
FROM (VALUES
  ('PE','Zona da Mata e Litoral','Rio Formoso'),
  ('PI','Teresina e Norte do Piauí','Assunção do Piauí')
) AS v(uf, region_name, city)
JOIN public.tb_region r ON r.uf = v.uf AND r.name = v.region_name
ON CONFLICT (uf, municipio_norm) DO NOTHING;

UPDATE public.tb_profile p
SET id_region = rc.id_region
FROM public.tb_region_city rc
WHERE rc.uf = p.estado
  AND p.municipio IS NOT NULL
  AND rc.municipio_norm = fl_norm_city(p.municipio)
  AND p.id_region IS DISTINCT FROM rc.id_region;
