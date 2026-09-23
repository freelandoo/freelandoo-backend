-- =============================================================================
-- Migration 255: controle das partições da base fria (R2).
--
-- ─── POR QUE ESTA TABELA EXISTE ─────────────────────────────────────────────
--
-- A mig 254 desenhou a descoberta como trabalho de FILA, uma cidade por vez. A
-- base fria (`scripts/prospect/build-partitions.js` → R2) acrescenta um segundo
-- caminho: um arquivo pronto por (estado, categoria), baixado e ingerido de uma
-- vez. E esse caminho precisa saber UMA coisa que nenhuma tabela existente
-- responde: **esta partição já foi trazida?**
--
-- ⚠️ CONTAR EMPRESAS NÃO RESPONDE ISSO, e a diferença não é acadêmica: ela foi
-- encontrada em teste. O primeiro reabastecimento de (SP, academia) foi
-- interrompido no meio, com 195 das 2.325 empresas gravadas. Um predicado do
-- tipo `COUNT(*) > 0` lê isso como "já está pronto" e **nunca mais completa** —
-- a categoria fica permanentemente com 8% do conteúdo, sem erro nenhum, e a
-- tela mostra uma base rasa como se fosse a base inteira.
--
-- Aqui a linha só é gravada DEPOIS que a ingestão termina. Partição
-- interrompida simplesmente não tem linha, e a próxima tentativa refaz.
--
-- ⚠️ O PREFIXO FAZ PARTE DA CHAVE. O lote é versionado por mês
-- (`prospect/osm/2026-09`); sem o prefixo na chave, subir o lote de outubro
-- deixaria todas as partições marcadas como prontas pelo lote de setembro, e
-- nenhuma seria reimportada — o dado novo ficaria no R2 sem nunca ser lido.
--
-- Idempotente (CREATE ... IF NOT EXISTS).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_company_partition (
  id_partition   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prefix         TEXT        NOT NULL,
  uf             CHAR(2)     NOT NULL,
  category_key   VARCHAR(40) NOT NULL,
  -- O que o arquivo trazia e o que virou linha: a diferença entre os dois é o
  -- que já existia na base, e é o número que diz se o lote está rendendo.
  found          INTEGER     NOT NULL DEFAULT 0,
  created        INTEGER     NOT NULL DEFAULT 0,
  updated        INTEGER     NOT NULL DEFAULT 0,
  skipped        INTEGER     NOT NULL DEFAULT 0,
  duration_ms    INTEGER,
  filled_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Uma linha por (lote, estado, categoria). O UPSERT do service se apoia nela.
CREATE UNIQUE INDEX IF NOT EXISTS ux_company_partition
  ON public.tb_company_partition (prefix, uf, category_key);

-- A pergunta do caminho quente: "esta partição já veio?", respondida pelo
-- índice acima. Este outro serve ao painel: "o que o lote deste mês cobriu?".
CREATE INDEX IF NOT EXISTS ix_company_partition_prefix
  ON public.tb_company_partition (prefix, filled_at DESC);
