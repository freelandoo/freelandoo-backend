-- =============================================================================
-- Migration 328: ALCANCE REGIONAL do feed (tópico A1, 2026-11)
-- =============================================================================
-- O post nasce na cidade do autor e sobe de degrau pelos pontos de alcance:
-- cidade (0) → área (1) → região (2) → estado (3) → Brasil (4). Só sobe.
-- Pesos, curva da velocidade e limiares: src/utils/feedReach.js (fonte da
-- verdade). O que aqui repete a regra (fl_reach_factor e o backfill do degrau)
-- é ESPELHO — o e2e test:feed-reach confere.
--
-- 1. Camada ÁREA entre cidade e região: sub-regiões oficiais das regiões
--    metropolitanas. Semeada só a Grande SP (LC estadual 1.139/2011, art. 4º:
--    Norte, Leste, Sudeste, Sudoeste, Oeste). A capital "integra todas as
--    sub-regiões" (§ 1º) → fica sem área; o post dela pula da cidade direto
--    para a região. Cidade sem área = idem.
-- 2. Lugar do autor CONGELADO no post na publicação (trigger) + backfill.
-- 3. reach_points (NÃO substitui engagement_score, usado por mix/ranking/
--    calor), reach_level, dislikes_count — em posts e bees (tb_story).
-- 4. tb_reach_action: ações que contam UMA vez por pessoa para sempre
--    (view, profile_click, whatsapp_click, share). Pessoa = 'u:<id_user>' ou
--    's:<session_id>'.
-- 5. "Não gostei": tb_portfolio_dislike / tb_story_dislike (um por pessoa,
--    exclusivo com a curtida; o número não é público).
-- =============================================================================

-- ─── 1. Áreas ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_area (
  id_area     SERIAL       PRIMARY KEY,
  id_region   INT          NOT NULL REFERENCES public.tb_region(id_region) ON DELETE CASCADE,
  uf          VARCHAR(2)   NOT NULL,
  name        VARCHAR(160) NOT NULL,
  source      VARCHAR(200),
  sort_order  INT          NOT NULL DEFAULT 0,
  UNIQUE (uf, name)
);

CREATE TABLE IF NOT EXISTS public.tb_area_city (
  id_area        INT          NOT NULL REFERENCES public.tb_area(id_area) ON DELETE CASCADE,
  uf             VARCHAR(2)   NOT NULL,
  municipio_norm VARCHAR(160) NOT NULL,
  PRIMARY KEY (uf, municipio_norm)
);
CREATE INDEX IF NOT EXISTS ix_tb_area_city_area ON public.tb_area_city (id_area);

INSERT INTO public.tb_area (id_region, uf, name, source, sort_order)
SELECT r.id_region, 'SP', v.name, 'LC-SP 1.139/2011, art. 4º', v.ord
  FROM public.tb_region r
  JOIN (VALUES
    ('Norte da Grande SP', 1),
    ('Alto Tietê', 2),
    ('ABC Paulista', 3),
    ('Sudoeste da Grande SP', 4),
    ('Oeste da Grande SP', 5)
  ) AS v(name, ord) ON TRUE
 WHERE r.uf = 'SP' AND r.name = 'Capital e Grande São Paulo'
ON CONFLICT (uf, name) DO NOTHING;

-- Nomes das sub-regiões na lei: I Norte, II Leste, III Sudeste, IV Sudoeste,
-- V Oeste. Os nomes acima são os de uso comum (Leste = Alto Tietê, Sudeste =
-- ABC), que é o que o autor lê em "Seu post chegou ao ABC Paulista".
INSERT INTO public.tb_area_city (id_area, uf, municipio_norm)
SELECT a.id_area, 'SP', fl_norm_city(v.city)
  FROM (VALUES
    ('Norte da Grande SP','Caieiras'),('Norte da Grande SP','Cajamar'),
    ('Norte da Grande SP','Francisco Morato'),('Norte da Grande SP','Franco da Rocha'),
    ('Norte da Grande SP','Mairiporã'),
    ('Alto Tietê','Arujá'),('Alto Tietê','Biritiba-Mirim'),('Alto Tietê','Biritiba Mirim'),
    ('Alto Tietê','Ferraz de Vasconcelos'),('Alto Tietê','Guararema'),('Alto Tietê','Guarulhos'),
    ('Alto Tietê','Itaquaquecetuba'),('Alto Tietê','Mogi das Cruzes'),('Alto Tietê','Poá'),
    ('Alto Tietê','Salesópolis'),('Alto Tietê','Santa Isabel'),('Alto Tietê','Suzano'),
    ('ABC Paulista','Diadema'),('ABC Paulista','Mauá'),('ABC Paulista','Ribeirão Pires'),
    ('ABC Paulista','Rio Grande da Serra'),('ABC Paulista','Santo André'),
    ('ABC Paulista','São Bernardo do Campo'),('ABC Paulista','São Caetano do Sul'),
    ('Sudoeste da Grande SP','Cotia'),('Sudoeste da Grande SP','Embu'),
    ('Sudoeste da Grande SP','Embu das Artes'),('Sudoeste da Grande SP','Embu-Guaçu'),
    ('Sudoeste da Grande SP','Embu Guaçu'),('Sudoeste da Grande SP','Itapecerica da Serra'),
    ('Sudoeste da Grande SP','Juquitiba'),('Sudoeste da Grande SP','São Lourenço da Serra'),
    ('Sudoeste da Grande SP','Taboão da Serra'),('Sudoeste da Grande SP','Vargem Grande Paulista'),
    ('Oeste da Grande SP','Barueri'),('Oeste da Grande SP','Carapicuíba'),
    ('Oeste da Grande SP','Itapevi'),('Oeste da Grande SP','Jandira'),
    ('Oeste da Grande SP','Osasco'),('Oeste da Grande SP','Pirapora do Bom Jesus'),
    ('Oeste da Grande SP','Santana de Parnaíba')
  ) AS v(area, city)
  JOIN public.tb_area a ON a.uf = 'SP' AND a.name = v.area
ON CONFLICT (uf, municipio_norm) DO NOTHING;

-- ─── 2. Fator do limiar (espelho de feedReach.reachFactor) ───────────────────
-- 8 primeiros dígitos hex do uuid → [0,85; 1,15].
CREATE OR REPLACE FUNCTION fl_reach_factor(p_id UUID) RETURNS NUMERIC AS $$
  SELECT 0.85 + 0.30 * (
    ('x' || substr(replace(p_id::text, '-', ''), 1, 8))::bit(32)::bigint::numeric
    / 4294967295::numeric
  );
$$ LANGUAGE sql IMMUTABLE;

-- Lugar do autor: o perfil que publicou; sem cidade nele, o perfil-conta da
-- mesma pessoa. Região pelo perfil ou pela tabela cidade→região; área pela
-- tb_area_city.
CREATE OR REPLACE FUNCTION fl_reach_place(p_id_profile UUID)
RETURNS TABLE (city_key TEXT, city_name TEXT, area_id INT, region_id INT, uf TEXT) AS $$
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
  SELECT NULLIF(fl_norm_city(b.municipio), '')                  AS city_key,
         NULLIF(trim(b.municipio), '')                           AS city_name,
         ac.id_area                                              AS area_id,
         COALESCE(b.id_region, rc.id_region)                     AS region_id,
         NULLIF(upper(trim(b.estado)), '')::text                 AS uf
    FROM best b
    LEFT JOIN public.tb_region_city rc
      ON rc.uf = upper(trim(b.estado)) AND rc.municipio_norm = fl_norm_city(b.municipio)
    LEFT JOIN public.tb_area_city ac
      ON ac.uf = upper(trim(b.estado)) AND ac.municipio_norm = fl_norm_city(b.municipio);
$$ LANGUAGE sql STABLE;

-- ─── 3. Colunas ──────────────────────────────────────────────────────────────
ALTER TABLE public.tb_profile_portfolio_item
  ADD COLUMN IF NOT EXISTS reach_points     NUMERIC     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reach_level      SMALLINT    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reach_level_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reach_city_key   TEXT,
  ADD COLUMN IF NOT EXISTS reach_city_name  TEXT,
  ADD COLUMN IF NOT EXISTS reach_area_id    INT,
  ADD COLUMN IF NOT EXISTS reach_region_id  INT,
  ADD COLUMN IF NOT EXISTS reach_uf         VARCHAR(2),
  ADD COLUMN IF NOT EXISTS reach_frozen_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dislikes_count   INT         NOT NULL DEFAULT 0;

ALTER TABLE public.tb_story
  ADD COLUMN IF NOT EXISTS reach_points     NUMERIC     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reach_level      SMALLINT    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reach_level_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reach_city_key   TEXT,
  ADD COLUMN IF NOT EXISTS reach_city_name  TEXT,
  ADD COLUMN IF NOT EXISTS reach_area_id    INT,
  ADD COLUMN IF NOT EXISTS reach_region_id  INT,
  ADD COLUMN IF NOT EXISTS reach_uf         VARCHAR(2),
  ADD COLUMN IF NOT EXISTS reach_frozen_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dislikes_count   INT         NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ppi_reach_level') THEN
    ALTER TABLE public.tb_profile_portfolio_item
      ADD CONSTRAINT chk_ppi_reach_level CHECK (reach_level BETWEEN 0 AND 4);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_story_reach_level') THEN
    ALTER TABLE public.tb_story
      ADD CONSTRAINT chk_story_reach_level CHECK (reach_level BETWEEN 0 AND 4);
  END IF;
END $$;

-- Feed por faixa de alcance: o CTE de candidatos filtra/ordena por estas.
CREATE INDEX IF NOT EXISTS ix_ppi_reach
  ON public.tb_profile_portfolio_item (reach_level, reach_uf, reach_region_id, reach_area_id, reach_city_key)
  WHERE status = 'published' AND is_active = TRUE;
CREATE INDEX IF NOT EXISTS ix_story_reach
  ON public.tb_story (reach_level, reach_uf, reach_region_id, reach_area_id, reach_city_key)
  WHERE kind = 'bee' AND deleted_at IS NULL;

-- ─── 4. Ações únicas por pessoa ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_reach_action (
  target_kind VARCHAR(8)  NOT NULL,
  id_target   UUID        NOT NULL,
  action      VARCHAR(16) NOT NULL,
  viewer_key  VARCHAR(80) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (target_kind, id_target, action, viewer_key),
  CONSTRAINT chk_reach_action_kind CHECK (target_kind IN ('post', 'bee')),
  CONSTRAINT chk_reach_action_action CHECK (action IN ('view', 'profile_click', 'whatsapp_click', 'share'))
);
-- Velocidade do compartilhamento: contagem das últimas 6 h por post.
CREATE INDEX IF NOT EXISTS ix_reach_action_recent
  ON public.tb_reach_action (target_kind, id_target, action, created_at DESC);

-- ─── 5. Não gostei ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_portfolio_dislike (
  id_portfolio_item UUID        NOT NULL REFERENCES public.tb_profile_portfolio_item(id_portfolio_item) ON DELETE CASCADE,
  id_user           UUID        NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_portfolio_item, id_user)
);
CREATE TABLE IF NOT EXISTS public.tb_story_dislike (
  id_story   UUID        NOT NULL REFERENCES public.tb_story(id_story) ON DELETE CASCADE,
  id_user    UUID        NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_story, id_user)
);

-- ─── 6. Congelar o lugar na publicação ───────────────────────────────────────
CREATE OR REPLACE FUNCTION fl_reach_freeze() RETURNS TRIGGER AS $$
DECLARE
  pl RECORD;
BEGIN
  IF NEW.reach_frozen_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  -- IF aninhado: tb_story não tem status (o plpgsql resolveria NEW.status).
  IF TG_TABLE_NAME = 'tb_profile_portfolio_item' THEN
    IF NEW.status IS DISTINCT FROM 'published' THEN
      RETURN NEW;
    END IF;
  END IF;
  SELECT * INTO pl FROM fl_reach_place(NEW.id_profile);
  NEW.reach_city_key  := pl.city_key;
  NEW.reach_city_name := pl.city_name;
  NEW.reach_area_id   := pl.area_id;
  NEW.reach_region_id := pl.region_id;
  NEW.reach_uf        := pl.uf;
  NEW.reach_frozen_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ppi_reach_freeze ON public.tb_profile_portfolio_item;
CREATE TRIGGER trg_ppi_reach_freeze
  BEFORE INSERT OR UPDATE OF status ON public.tb_profile_portfolio_item
  FOR EACH ROW EXECUTE FUNCTION fl_reach_freeze();

DROP TRIGGER IF EXISTS trg_story_reach_freeze ON public.tb_story;
CREATE TRIGGER trg_story_reach_freeze
  BEFORE INSERT ON public.tb_story
  FOR EACH ROW EXECUTE FUNCTION fl_reach_freeze();

-- ─── 7. Backfill: lugar ──────────────────────────────────────────────────────
UPDATE public.tb_profile_portfolio_item i
   SET reach_city_key = pl.city_key, reach_city_name = pl.city_name,
       reach_area_id = pl.area_id, reach_region_id = pl.region_id,
       reach_uf = pl.uf, reach_frozen_at = COALESCE(i.published_at, NOW())
  FROM public.tb_profile_portfolio_item i2
  CROSS JOIN LATERAL fl_reach_place(i2.id_profile) pl
 WHERE i2.id_portfolio_item = i.id_portfolio_item
   AND i.reach_frozen_at IS NULL
   AND i.status = 'published';

UPDATE public.tb_story s
   SET reach_city_key = pl.city_key, reach_city_name = pl.city_name,
       reach_area_id = pl.area_id, reach_region_id = pl.region_id,
       reach_uf = pl.uf, reach_frozen_at = s.created_at
  FROM public.tb_story s2
  CROSS JOIN LATERAL fl_reach_place(s2.id_profile) pl
 WHERE s2.id_story = s.id_story
   AND s.reach_frozen_at IS NULL;

-- ─── 8. Backfill: ações únicas e pontos ──────────────────────────────────────
-- Quem já viu/clicou/compartilhou entra na tabela para não contar de novo.
INSERT INTO public.tb_reach_action (target_kind, id_target, action, viewer_key, created_at)
SELECT 'post', e.id_portfolio_item,
       CASE e.event_type WHEN 'impression' THEN 'view' ELSE e.event_type END,
       CASE WHEN e.id_user IS NOT NULL THEN 'u:' || e.id_user::text ELSE 's:' || left(e.session_id, 64) END,
       MIN(e.created_at)
  FROM public.tb_portfolio_event e
 WHERE e.event_type IN ('impression', 'profile_click', 'whatsapp_click', 'share')
   AND (e.id_user IS NOT NULL OR e.session_id IS NOT NULL)
 GROUP BY 1, 2, 3, 4
ON CONFLICT DO NOTHING;

INSERT INTO public.tb_reach_action (target_kind, id_target, action, viewer_key, created_at)
SELECT 'bee', v.id_story, 'view', 'u:' || v.id_viewer_user::text, MIN(v.viewed_at)
  FROM public.tb_story_view v
 GROUP BY 1, 2, 3, 4
ON CONFLICT DO NOTHING;

INSERT INTO public.tb_reach_action (target_kind, id_target, action, viewer_key, created_at)
SELECT 'bee', e.id_story, 'share',
       CASE WHEN e.id_user IS NOT NULL THEN 'u:' || e.id_user::text ELSE 's:' || left(e.session_id, 64) END,
       MIN(e.created_at)
  FROM public.tb_story_event e
 WHERE e.event_type = 'share'
   AND (e.id_user IS NOT NULL OR e.session_id IS NOT NULL)
 GROUP BY 1, 2, 3, 4
ON CONFLICT DO NOTHING;

-- Pontos pela fórmula (compartilhamento antigo vale 40, velocidade 1,0 — não
-- dá para reconstruir a janela de 6 h com fidelidade). Só onde ainda é 0.
UPDATE public.tb_profile_portfolio_item i
   SET reach_points = x.pts
  FROM (
    SELECT i2.id_portfolio_item,
           COALESCE((SELECT SUM(CASE a.action WHEN 'view' THEN 1 WHEN 'profile_click' THEN 4
                                               WHEN 'whatsapp_click' THEN 6 WHEN 'share' THEN 40 END)
                       FROM public.tb_reach_action a
                      WHERE a.target_kind = 'post' AND a.id_target = i2.id_portfolio_item), 0)
         + 5  * GREATEST(i2.likes_count, 0)
         + 10 * (SELECT COUNT(*) FROM public.tb_portfolio_comment c
                  WHERE c.id_portfolio_item = i2.id_portfolio_item AND c.is_active = TRUE)
         + 30 * (SELECT COUNT(*) FROM public.user_bookmark_item b
                  WHERE b.id_portfolio_item = i2.id_portfolio_item)
         + COALESCE((SELECT SUM(FLOOR(r.seconds_watched / 10.0))
                       FROM public.portfolio_content_retention r
                      WHERE r.id_portfolio_item = i2.id_portfolio_item), 0) AS pts
      FROM public.tb_profile_portfolio_item i2
  ) x
 WHERE x.id_portfolio_item = i.id_portfolio_item
   AND i.reach_points = 0
   AND x.pts > 0;

UPDATE public.tb_story s
   SET reach_points = x.pts
  FROM (
    SELECT s2.id_story,
           COALESCE((SELECT SUM(CASE a.action WHEN 'view' THEN 1 WHEN 'share' THEN 40 ELSE 0 END)
                       FROM public.tb_reach_action a
                      WHERE a.target_kind = 'bee' AND a.id_target = s2.id_story), 0)
         + 5  * GREATEST(s2.likes_count, 0)
         + 10 * GREATEST(s2.comments_count, 0)
         + 30 * (SELECT COUNT(*) FROM public.tb_story_bookmark b WHERE b.id_story = s2.id_story) AS pts
      FROM public.tb_story s2
  ) x
 WHERE x.id_story = s.id_story
   AND s.reach_points = 0
   AND x.pts > 0;

-- Degrau pelos pontos (espelho de feedReach.reachLevelFor: metas 1 mil /
-- 10 mil / 100 mil / 300 mil × fator; degrau sem lugar é pulado; sem UF só o
-- Brasil). GREATEST: o alcance só sobe.
UPDATE public.tb_profile_portfolio_item i
   SET reach_level = GREATEST(i.reach_level, lv.l),
       reach_level_at = CASE WHEN lv.l > i.reach_level THEN NOW() ELSE i.reach_level_at END
  FROM public.tb_profile_portfolio_item i2
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN i2.reach_points >= 300000 * fl_reach_factor(i2.id_portfolio_item) THEN 4
      WHEN i2.reach_uf IS NULL THEN 0
      WHEN i2.reach_points >= 100000 * fl_reach_factor(i2.id_portfolio_item) THEN 3
      WHEN i2.reach_points >= 10000 * fl_reach_factor(i2.id_portfolio_item)
        THEN CASE WHEN i2.reach_region_id IS NULL THEN 3 ELSE 2 END
      WHEN i2.reach_points >= 1000 * fl_reach_factor(i2.id_portfolio_item)
        THEN CASE WHEN i2.reach_area_id IS NOT NULL THEN 1
                  WHEN i2.reach_region_id IS NOT NULL THEN 2 ELSE 3 END
      ELSE 0 END AS l
  ) lv
 WHERE i2.id_portfolio_item = i.id_portfolio_item
   AND i.reach_points > 0;

UPDATE public.tb_story s
   SET reach_level = GREATEST(s.reach_level, lv.l),
       reach_level_at = CASE WHEN lv.l > s.reach_level THEN NOW() ELSE s.reach_level_at END
  FROM public.tb_story s2
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN s2.reach_points >= 300000 * fl_reach_factor(s2.id_story) THEN 4
      WHEN s2.reach_uf IS NULL THEN 0
      WHEN s2.reach_points >= 100000 * fl_reach_factor(s2.id_story) THEN 3
      WHEN s2.reach_points >= 10000 * fl_reach_factor(s2.id_story)
        THEN CASE WHEN s2.reach_region_id IS NULL THEN 3 ELSE 2 END
      WHEN s2.reach_points >= 1000 * fl_reach_factor(s2.id_story)
        THEN CASE WHEN s2.reach_area_id IS NOT NULL THEN 1
                  WHEN s2.reach_region_id IS NOT NULL THEN 2 ELSE 3 END
      ELSE 0 END AS l
  ) lv
 WHERE s2.id_story = s.id_story
   AND s.reach_points > 0;
