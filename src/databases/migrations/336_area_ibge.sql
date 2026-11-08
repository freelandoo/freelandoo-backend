-- =============================================================================
-- Migration 336: ÁREA = Região Geográfica Imediata do IBGE (tópico T2, 2026-11)
-- =============================================================================
-- Camada entre cidade e região: cidade → ÁREA → região → estado.
-- A mig 328 (A1) criou tb_area/tb_area_city só para a Grande SP (sub-regiões
-- da LC-SP 1.139/2011, por nome). Aqui a área passa a valer para o Brasil
-- todo:
--
--   base     = Regiões Geográficas Imediatas do IBGE (2017), 510 áreas;
--   override = tb_area_override, por município: manda o município para outra
--              área (criada pelo nome se não existir) ou para NENHUMA
--              (area_name NULL). É dado, não código: ajustar = editar
--              scripts/data/area-overrides.csv e gerar a migration de dados
--              (node scripts/ibge-areas.js sql NNN).
--
-- A imediata "São Paulo" do IBGE é a Grande SP inteira (39 municípios) e
-- engolia o ABC. Os overrides semeados (mig 337) mantêm as 5 sub-regiões do
-- A1 — ABC Paulista, Alto Tietê, Norte, Sudoeste, Oeste — e a capital SEM área
-- (regra do A1: o post da capital pula da cidade direto para a região).
--
-- Esta migration só cria a estrutura e as funções; os dados entram na 337
-- (gerada pelo script a partir do CSV oficial).
--
--   tb_ibge_municipio  municípios do IBGE com a imediata/intermediária
--   tb_area            + code_ibge (imediata), kind ibge|manual, is_active
--   tb_area_city       + cod_municipio (NULL nos apelidos digitados, ex. "Embu")
--   tb_area_override   ajuste manual por município
--   tb_profile.id_area resolvida na gravação (trigger) + backfill no rebuild
--   fl_area_rebuild()  refaz tb_area/tb_area_city a partir de IBGE + overrides
--   geo_tiers(perfil)  cidade, área, região, uf — a régua única (feed T4)
--
-- Os ids de tb_area NÃO mudam num rebuild (posts congelam reach_area_id):
-- área do IBGE é achada pelo código, manual pelo (uf, nome); área que fica
-- vazia vira is_active = FALSE, nunca é apagada.
-- =============================================================================

-- ─── Tabelas ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_ibge_municipio (
  cod_municipio  INT          PRIMARY KEY,
  nome           VARCHAR(160) NOT NULL,
  uf             VARCHAR(2)   NOT NULL,
  municipio_norm VARCHAR(160) NOT NULL,
  cod_rgi        INT          NOT NULL,
  nome_rgi       VARCHAR(200) NOT NULL,
  cod_rgint      INT          NOT NULL,
  nome_rgint     VARCHAR(200) NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_tb_ibge_municipio_norm ON public.tb_ibge_municipio (uf, municipio_norm);
CREATE INDEX IF NOT EXISTS ix_tb_ibge_municipio_rgi ON public.tb_ibge_municipio (cod_rgi);

ALTER TABLE public.tb_area
  ADD COLUMN IF NOT EXISTS code_ibge INT,
  ADD COLUMN IF NOT EXISTS kind      VARCHAR(16) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN     NOT NULL DEFAULT TRUE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_tb_area_code_ibge') THEN
    ALTER TABLE public.tb_area ADD CONSTRAINT uq_tb_area_code_ibge UNIQUE (code_ibge);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tb_area_kind') THEN
    ALTER TABLE public.tb_area ADD CONSTRAINT chk_tb_area_kind CHECK (kind IN ('ibge', 'manual'));
  END IF;
END $$;

ALTER TABLE public.tb_area_city
  ADD COLUMN IF NOT EXISTS cod_municipio INT;
CREATE INDEX IF NOT EXISTS ix_tb_area_city_cod ON public.tb_area_city (cod_municipio);

CREATE TABLE IF NOT EXISTS public.tb_area_override (
  uf             VARCHAR(2)   NOT NULL,
  municipio_norm VARCHAR(160) NOT NULL,
  municipio      VARCHAR(160) NOT NULL,
  area_name      VARCHAR(160),            -- NULL = município sem área
  source         VARCHAR(200),
  PRIMARY KEY (uf, municipio_norm)
);

ALTER TABLE public.tb_profile
  ADD COLUMN IF NOT EXISTS id_area INT REFERENCES public.tb_area(id_area) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_tb_profile_area ON public.tb_profile (id_area);

-- ─── Área do perfil na gravação ─────────────────────────────────────────────
-- Toda porta que grava a cidade do perfil (cadastro, onboarding, edição,
-- academia…) passa por aqui: a área sai da cidade + UF, sempre.
CREATE OR REPLACE FUNCTION fl_area_of(p_uf TEXT, p_municipio TEXT) RETURNS INT AS $$
  SELECT ac.id_area
    FROM public.tb_area_city ac
   WHERE ac.uf = upper(trim(coalesce(p_uf, '')))
     AND ac.municipio_norm = fl_norm_city(p_municipio)
     AND COALESCE(trim(p_municipio), '') <> '';
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION fl_profile_area_tg() RETURNS TRIGGER AS $$
BEGIN
  NEW.id_area := fl_area_of(NEW.estado, NEW.municipio);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_profile_area ON public.tb_profile;
CREATE TRIGGER trg_profile_area
  BEFORE INSERT OR UPDATE OF municipio, estado ON public.tb_profile
  FOR EACH ROW EXECUTE FUNCTION fl_profile_area_tg();

-- ─── Rebuild: IBGE + overrides → tb_area / tb_area_city / tb_profile ────────
CREATE OR REPLACE FUNCTION fl_area_rebuild()
RETURNS TABLE (areas_active INT, cities INT, profiles_changed INT) AS $$
DECLARE
  v_profiles INT;
BEGIN
  -- Região de cada município (a tabela cidade → região da mig 123).
  CREATE TEMP TABLE IF NOT EXISTS _area_mun (
    uf TEXT, municipio_norm TEXT, cod_municipio INT, cod_rgi INT,
    id_region INT, override BOOLEAN, area_name TEXT, source TEXT
  ) ON COMMIT DROP;
  TRUNCATE _area_mun;

  -- Municípios do IBGE, com o override (se houver) por cima.
  INSERT INTO _area_mun
  SELECT m.uf, m.municipio_norm, m.cod_municipio, m.cod_rgi, rc.id_region,
         (o.municipio_norm IS NOT NULL), o.area_name, o.source
    FROM public.tb_ibge_municipio m
    LEFT JOIN public.tb_area_override o
      ON o.uf = m.uf AND o.municipio_norm = m.municipio_norm
    LEFT JOIN public.tb_region_city rc
      ON rc.uf = m.uf AND rc.municipio_norm = m.municipio_norm;

  -- Apelidos (override de um nome que não é município do IBGE: "Embu",
  -- "Biritiba-Mirim"…): entram como cidade da área, sem código.
  INSERT INTO _area_mun
  SELECT o.uf, o.municipio_norm, NULL, NULL, rc.id_region, TRUE, o.area_name, o.source
    FROM public.tb_area_override o
    LEFT JOIN public.tb_region_city rc
      ON rc.uf = o.uf AND rc.municipio_norm = o.municipio_norm
   WHERE o.area_name IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.tb_ibge_municipio m
                      WHERE m.uf = o.uf AND m.municipio_norm = o.municipio_norm);

  -- 1. Áreas do IBGE (uma por imediata). A região é a da maioria dos
  --    municípios (as 99 regiões da casa não seguem o IBGE: 80 imediatas
  --    caem em duas). Nome repetido com uma área manual da UF ganha " (IBGE)".
  INSERT INTO public.tb_area (id_region, uf, name, source, sort_order, code_ibge, kind, is_active)
  SELECT COALESCE(g.id_region,
                  (SELECT r.id_region FROM public.tb_region r
                    WHERE r.uf = g.uf ORDER BY r.sort_order, r.id_region LIMIT 1)),
         g.uf,
         CASE WHEN EXISTS (SELECT 1 FROM public.tb_area a
                            WHERE a.uf = g.uf AND a.name = g.nome_rgi
                              AND a.code_ibge IS DISTINCT FROM g.cod_rgi)
              THEN g.nome_rgi || ' (IBGE)' ELSE g.nome_rgi END,
         'IBGE — Região Geográfica Imediata ' || g.cod_rgi,
         g.cod_rgi % 10000,
         g.cod_rgi, 'ibge', TRUE
    FROM (
      SELECT m.uf, m.cod_rgi, m.nome_rgi,
             mode() WITHIN GROUP (ORDER BY rc.id_region) AS id_region
        FROM public.tb_ibge_municipio m
        LEFT JOIN public.tb_region_city rc
          ON rc.uf = m.uf AND rc.municipio_norm = m.municipio_norm
       GROUP BY m.uf, m.cod_rgi, m.nome_rgi
    ) g
  ON CONFLICT (code_ibge) DO UPDATE
     SET name = EXCLUDED.name, id_region = EXCLUDED.id_region, uf = EXCLUDED.uf,
         source = EXCLUDED.source, sort_order = EXCLUDED.sort_order;

  -- 2. Áreas manuais pedidas pelos overrides e que ainda não existem.
  INSERT INTO public.tb_area (id_region, uf, name, source, sort_order, kind, is_active)
  SELECT COALESCE(mode() WITHIN GROUP (ORDER BY x.id_region),
                  (SELECT r.id_region FROM public.tb_region r
                    WHERE r.uf = x.uf ORDER BY r.sort_order, r.id_region LIMIT 1)),
         x.uf, x.area_name, max(x.source), 0, 'manual', TRUE
    FROM _area_mun x
   WHERE x.override AND x.area_name IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.tb_area a WHERE a.uf = x.uf AND a.name = x.area_name)
   GROUP BY x.uf, x.area_name
  ON CONFLICT (uf, name) DO NOTHING;

  -- 3. Cidade → área desejada.
  CREATE TEMP TABLE IF NOT EXISTS _area_want (
    uf TEXT, municipio_norm TEXT, cod_municipio INT, id_area INT
  ) ON COMMIT DROP;
  TRUNCATE _area_want;

  INSERT INTO _area_want
  SELECT x.uf, x.municipio_norm, x.cod_municipio,
         CASE WHEN x.override
              THEN (SELECT a.id_area FROM public.tb_area a
                     WHERE a.uf = x.uf AND a.name = x.area_name)
              ELSE (SELECT a.id_area FROM public.tb_area a WHERE a.code_ibge = x.cod_rgi)
         END
    FROM _area_mun x
   WHERE NOT x.override OR x.area_name IS NOT NULL;

  DELETE FROM public.tb_area_city ac
   WHERE NOT EXISTS (SELECT 1 FROM _area_want w
                      WHERE w.uf = ac.uf AND w.municipio_norm = ac.municipio_norm
                        AND w.id_area IS NOT NULL);

  INSERT INTO public.tb_area_city (id_area, uf, municipio_norm, cod_municipio)
  SELECT w.id_area, w.uf, w.municipio_norm, w.cod_municipio
    FROM _area_want w
   WHERE w.id_area IS NOT NULL
  ON CONFLICT (uf, municipio_norm) DO UPDATE
     SET id_area = EXCLUDED.id_area, cod_municipio = EXCLUDED.cod_municipio;

  -- 4. Área vazia sai de cena (sem apagar: posts guardam o id).
  UPDATE public.tb_area a
     SET is_active = EXISTS (SELECT 1 FROM public.tb_area_city ac WHERE ac.id_area = a.id_area)
   WHERE a.is_active IS DISTINCT FROM
         EXISTS (SELECT 1 FROM public.tb_area_city ac WHERE ac.id_area = a.id_area);

  -- 5. Backfill dos perfis.
  UPDATE public.tb_profile p
     SET id_area = fl_area_of(p.estado, p.municipio)
   WHERE p.id_area IS DISTINCT FROM fl_area_of(p.estado, p.municipio);
  GET DIAGNOSTICS v_profiles = ROW_COUNT;

  RETURN QUERY
  SELECT (SELECT count(*)::int FROM public.tb_area WHERE is_active),
         (SELECT count(*)::int FROM public.tb_area_city),
         v_profiles;
END;
$$ LANGUAGE plpgsql;

-- ─── geo_tiers: cidade, área, região, UF de um perfil ───────────────────────
-- O lugar é o do perfil; sem cidade nele, o do perfil-conta da mesma pessoa
-- (mesma regra do fl_reach_place da mig 328). Região: a do perfil ou a da
-- tabela cidade → região. Área: a da tabela cidade → área (a mesma que o
-- trigger grava em tb_profile.id_area).
CREATE OR REPLACE FUNCTION geo_tiers(p_id_profile UUID)
RETURNS TABLE (city_key TEXT, city_name TEXT, id_area INT, area_name TEXT,
               id_region INT, region_name TEXT, uf TEXT) AS $$
  WITH src AS (
    SELECT p.municipio, p.estado, p.id_region, 1 AS pri
      FROM public.tb_profile p
     WHERE p.id_profile = p_id_profile
       AND COALESCE(trim(p.municipio), '') <> ''
    UNION ALL
    SELECT acc.municipio, acc.estado, acc.id_region, 2 AS pri
      FROM public.tb_profile p
      JOIN public.tb_profile acc
        ON acc.id_user = p.id_user AND acc.is_user_account = TRUE AND acc.deleted_at IS NULL
     WHERE p.id_profile = p_id_profile
       AND COALESCE(trim(acc.municipio), '') <> ''
    UNION ALL
    SELECT NULL, p.estado, p.id_region, 3 AS pri
      FROM public.tb_profile p
     WHERE p.id_profile = p_id_profile
  ), best AS (
    SELECT * FROM src ORDER BY pri LIMIT 1
  )
  SELECT NULLIF(fl_norm_city(b.municipio), '')            AS city_key,
         NULLIF(trim(b.municipio), '')                     AS city_name,
         a.id_area                                         AS id_area,
         a.name::text                                      AS area_name,
         r.id_region                                       AS id_region,
         r.name::text                                      AS region_name,
         NULLIF(upper(trim(b.estado)), '')::text           AS uf
    FROM best b
    LEFT JOIN public.tb_region_city rc
      ON rc.uf = upper(trim(b.estado)) AND rc.municipio_norm = fl_norm_city(b.municipio)
    LEFT JOIN public.tb_region r
      ON r.id_region = COALESCE(b.id_region, rc.id_region)
    LEFT JOIN public.tb_area a
      ON a.id_area = fl_area_of(b.estado, b.municipio);
$$ LANGUAGE sql STABLE;
