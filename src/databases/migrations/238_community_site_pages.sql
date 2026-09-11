-- 238_community_site_pages.sql
--
-- DUAS COLUNAS: uma que o site nunca teve, e outra que ele PRECISAVA TER E NÃO
-- TEM — a segunda é um defeito silencioso que está em produção hoje.
--
-- ─── 1. `text_styles` — O TAMANHO DO TEXTO NUNCA FOI GRAVADO ────────────────
--
-- O construtor ganhou alças de dimensionamento em 2026-09-03 e o gesto de
-- mover a caixa em 2026-09-10. As duas entregas gravam em `config.textStyles`,
-- e `normalizeConfig` valida esse mapa campo a campo até hoje.
--
-- ⚠️ MAS NÃO EXISTE COLUNA. O `upsert` do storage persiste site_name, tagline,
-- theme e sections — e mais nada. `toConfig` projeta os mesmos quatro. Ou seja:
-- o líder arrasta a alça, o canvas responde, o autosave envia, o backend
-- valida... e o valor é descartado no caminho para o banco. No recarregamento
-- seguinte o GET devolve um documento sem `textStyles` e TUDO volta ao padrão.
--
-- É o pior formato de defeito: a tela confirma o gesto, nada dá erro, e a
-- perda só aparece depois — quando a pessoa já não liga o sumiço à ação. Por
-- isso a coluna entra aqui, junto de quem a usaria de qualquer forma.
--
-- ─── 2. `pages` — SUB-PÁGINAS ───────────────────────────────────────────────
--
-- O site era de UMA página: `sections` é um array só, e o roteador do site
-- publicado conhecia a home mais o `/agendar` da mig 221. Isso basta para uma
-- vitrine, e não basta para um negócio que precisa de uma página por serviço e
-- uma por cidade atendida — que é o que responde em busca local.
--
-- `sections` FICA sendo a home, intocada. Quem já publicou não muda de forma:
-- documento sem `pages` continua valendo e a coluna nasce com lista vazia.
-- Sub-página é acréscimo, nunca migração de quem existe.
--
-- Os tetos de tamanho espelham os de `sections` pela mesma razão declarada na
-- mig 212: JSONB sem limite é um jeito de alguém gravar 10 MB por linha.

ALTER TABLE public.tb_community_site
  ADD COLUMN IF NOT EXISTS text_styles JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.tb_community_site
  ADD COLUMN IF NOT EXISTS pages JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Os CHECKs são NOMEADOS e removidos antes de recriados: é o que torna a
-- migration idempotente no boot, e o que permite ao teste conferir a recusa
-- pelo NOME da constraint em vez de pela mensagem do Postgres.
ALTER TABLE public.tb_community_site
  DROP CONSTRAINT IF EXISTS chk_community_site_text_styles_object;
ALTER TABLE public.tb_community_site
  ADD CONSTRAINT chk_community_site_text_styles_object
  CHECK (jsonb_typeof(text_styles) = 'object');

ALTER TABLE public.tb_community_site
  DROP CONSTRAINT IF EXISTS chk_community_site_text_styles_size;
ALTER TABLE public.tb_community_site
  ADD CONSTRAINT chk_community_site_text_styles_size
  CHECK (pg_column_size(text_styles) <= 65536);

ALTER TABLE public.tb_community_site
  DROP CONSTRAINT IF EXISTS chk_community_site_pages_array;
ALTER TABLE public.tb_community_site
  ADD CONSTRAINT chk_community_site_pages_array
  CHECK (jsonb_typeof(pages) = 'array');

-- O teto de `pages` é maior que o de `sections` porque ele guarda VÁRIAS
-- pilhas de seções — uma por sub-página — e não uma.
ALTER TABLE public.tb_community_site
  DROP CONSTRAINT IF EXISTS chk_community_site_pages_size;
ALTER TABLE public.tb_community_site
  ADD CONSTRAINT chk_community_site_pages_size
  CHECK (pg_column_size(pages) <= 1048576);
