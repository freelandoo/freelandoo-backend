-- =============================================================================
-- Migration 212: "Meu Site" — site próprio da comunidade
-- =============================================================================
-- O líder monta um site público da comunidade num construtor visual (WYSIWYG)
-- dentro da própria página: clica no texto e edita, clica no banner e troca a
-- foto, adiciona/reordena/remove seções e troca a paleta de cores.
--
-- POR QUE JSONB E NÃO TABELAS NORMALIZADAS:
-- as seções são um DOCUMENTO ordenado e heterogêneo (hero tem slides, catálogo
-- tem itens com preço, depoimentos têm nota) que só é lido e gravado INTEIRO —
-- nunca há "busque todos os depoimentos de todas as comunidades". Normalizar
-- custaria 6 tabelas e um JOIN por render sem ganhar uma única consulta. É a
-- mesma escolha já feita em tb_profile.community_theme e nos atributos de
-- produto (mig 139).
--
-- O PREÇO DESSA ESCOLHA, e como ele é pago: o banco não valida o conteúdo de
-- um JSONB. Quem valida é `src/utils/communitySite.js`, a FONTE ÚNICA de
-- normalização — todo payload que entra passa por lá antes do UPDATE (tetos de
-- tamanho, cor hexadecimal de verdade, URL só http(s), kind de seção fechado,
-- chaves desconhecidas descartadas). Gravar direto por SQL fura essa validação.
--
-- publicado × rascunho: o site só aparece para os outros depois de publicado.
-- Enquanto `is_published = FALSE` a linha existe e só o líder enxerga — é isso
-- que deixa o construtor salvar sozinho (autosave) sem expor obra inacabada.
--
-- Idempotente. (O runner já envolve cada migration em transação própria.)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_community_site (
  id_profile   UUID PRIMARY KEY
    REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  site_name    VARCHAR(120)  NOT NULL DEFAULT '',
  tagline      VARCHAR(240)  NOT NULL DEFAULT '',
  -- Paleta (primary/background/surface/textPrimary/textSecondary/accent).
  theme        JSONB         NOT NULL DEFAULT '{}'::jsonb,
  -- Lista ORDENADA de seções. A ordem do array É a ordem da página: reordenar
  -- no construtor é mover o item no array, não gravar um campo `position` que
  -- poderia divergir da ordem real.
  sections     JSONB         NOT NULL DEFAULT '[]'::jsonb,
  is_published BOOLEAN       NOT NULL DEFAULT FALSE,
  published_at TIMESTAMPTZ   NULL,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  -- Blindagem de última instância contra payload gigante (o service já corta
  -- bem antes): um JSONB de seções não tem por que passar de ~256 KB.
  CONSTRAINT chk_community_site_sections_size
    CHECK (pg_column_size(sections) <= 262144),
  CONSTRAINT chk_community_site_sections_array
    CHECK (jsonb_typeof(sections) = 'array'),
  CONSTRAINT chk_community_site_theme_object
    CHECK (jsonb_typeof(theme) = 'object')
);

-- Listagem dos sites publicados (vitrine futura / indexação): só as linhas
-- publicadas interessam, então o índice é parcial.
CREATE INDEX IF NOT EXISTS ix_community_site_published
  ON public.tb_community_site (published_at DESC)
  WHERE is_published = TRUE;

-- ─── Kill-switch ────────────────────────────────────────────────────────────
-- Nasce LIGADA, como 'condominio', 'bairro' e as três da mig 210: o Painel de
-- Controle serve para DESLIGAR se o lançamento precisar ser segurado, não para
-- lembrar de ligar. Ela barra a EDIÇÃO e a PUBLICAÇÃO; site já publicado
-- continua abrindo, pela mesma razão que GET /me/spaces não tem requireFeature.
INSERT INTO public.tb_feature_flag (flag_key, label, description, is_enabled)
VALUES
  ('comunidade_site', 'Meu Site da comunidade',
   'Site próprio da comunidade, montado pelo líder num construtor visual dentro da página (banners, catálogo de serviços, sobre, depoimentos, galeria e contato). Desligar esconde o construtor; os sites já publicados continuam no ar.',
   TRUE)
ON CONFLICT (flag_key) DO NOTHING;
