-- =============================================================================
-- Migration 137: snapshot de mercado (ações / cotações) + notícias (cache)
-- =============================================================================
-- Cache do widget financeiro da Wallet. O backend (Railway) puxa de fontes
-- externas (brapi.dev, CoinGecko) num scheduler e faz UPSERT aqui; o frontend
-- (Vercel) só LÊ este cache — nunca toca a API externa, pra não gerar
-- invocação/custo serverless por request. Idempotente.
--
-- tb_market_snapshot: 1 linha por símbolo (chave = symbol). kind separa
--   'stock' (ações mais vistas) de 'quote' (índices/moedas: IBOV, USD, EUR, BTC).
-- tb_market_news: manchetes de economia/política (reservada — populada no v2
--   por um fetcher de RSS; v1 deixa vazia e a UI mostra empty-state).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_market_snapshot (
  symbol        VARCHAR(24)   PRIMARY KEY,            -- PETR4, ^BVSP, USDBRL, BTC
  kind          VARCHAR(12)   NOT NULL DEFAULT 'stock', -- 'stock' | 'quote'
  label         VARCHAR(80)   NOT NULL,               -- "Petrobras PN", "Ibovespa", "Dólar"
  price         NUMERIC(18,4),                         -- preço/cotação atual
  change_pct    NUMERIC(10,4),                         -- variação % no dia
  currency      VARCHAR(8)    NOT NULL DEFAULT 'BRL',  -- BRL | USD | pts
  logo_url      TEXT,                                  -- logo do ativo (brapi)
  rank          INTEGER       NOT NULL DEFAULT 0,       -- ordem de exibição
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_snapshot_kind_rank
  ON public.tb_market_snapshot (kind, rank);

CREATE TABLE IF NOT EXISTS public.tb_market_news (
  id            BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source        VARCHAR(60),                           -- "InfoMoney", "G1 Economia"
  category      VARCHAR(20)   NOT NULL DEFAULT 'economia', -- 'economia' | 'politica'
  title         TEXT          NOT NULL,
  url           TEXT          NOT NULL,
  thumb_url     TEXT,
  published_at  TIMESTAMPTZ,
  fetched_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (url)
);

CREATE INDEX IF NOT EXISTS idx_market_news_published
  ON public.tb_market_news (published_at DESC NULLS LAST);
