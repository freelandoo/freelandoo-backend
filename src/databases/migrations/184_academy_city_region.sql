-- =============================================================================
-- Migration 184: Academia com cidade estruturada (UF + região)
-- O modal de cadastro passa a usar seletor de Estado + Município (IBGE) em vez
-- de texto livre. Guardamos a UF e resolvemos a região via tb_region_city
-- (mesma base dos perfis, migs 121/123) para habilitar indicadores por
-- cidade/região depois. Idempotente.
-- =============================================================================

ALTER TABLE public.tb_academy ADD COLUMN IF NOT EXISTS uf VARCHAR(2);
ALTER TABLE public.tb_academy
  ADD COLUMN IF NOT EXISTS id_region INT REFERENCES public.tb_region(id_region);

CREATE INDEX IF NOT EXISTS idx_academy_uf     ON public.tb_academy (uf);
CREATE INDEX IF NOT EXISTS idx_academy_region ON public.tb_academy (id_region);

-- Backfill best-effort das academias existentes (cidade era texto livre, sem
-- UF): só quando o nome normalizado do município existe em UMA única UF —
-- senão fica NULL e o dono ajusta depois.
UPDATE public.tb_academy a
   SET uf = rc.uf, id_region = rc.id_region
  FROM public.tb_region_city rc
 WHERE a.uf IS NULL
   AND a.cidade IS NOT NULL
   AND rc.municipio_norm = fl_norm_city(a.cidade)
   AND (SELECT COUNT(*) FROM public.tb_region_city rc2
         WHERE rc2.municipio_norm = rc.municipio_norm) = 1;
