// src/services/MarketService.js
//
// Coletor de mercado para o widget da Wallet. Roda NO BACKEND (Railway) via
// scheduler (index.js) e guarda o resultado em tb_market_snapshot. O frontend
// (Vercel) só lê o cache — nunca chama estas APIs externas (evita invocação
// serverless por request e rate-limit).
//
// Fontes (com fallback — o IP compartilhado do Railway toma 429 da AwesomeAPI):
//  - AwesomeAPI (grátis, sem chave): Dólar, Euro, Rublo e Bitcoin em BRL com
//    variação diária. PRIMÁRIA das cotações, mas rate-limitada no Railway.
//  - Fallbacks de cotação: CoinGecko (BTC, com variação 24h) e open.er-api.com
//    (USD/EUR/RUB, sem variação — o front mostra "—").
//  - brapi.dev: ações mais negociadas e Ibovespa. Exige BRAPI_TOKEN no env.
//  - Fallback de ações sem token: Yahoo Finance v8 (blue chips B3 fixas + ^BVSP).
//
// Tudo é best-effort: cada fonte é isolada; falha de uma não afeta as outras
// nem o cache já existente (UPSERT só sobrescreve o que veio).

const pool = require("../databases");
const MarketStorage = require("../storages/MarketStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("MarketService");

const BRAPI_BASE = "https://brapi.dev/api";
const AWESOME_BASE = "https://economia.awesomeapi.com.br/json/last";
const STOCKS_LIMIT = 8;

// Cotações via AwesomeAPI (sem token). symbol é a chave de UPSERT — BTC mantém
// "BTC" pra sobrescrever a linha antiga (CoinGecko) sem duplicar.
// Ordem de exibição: Bitcoin primeiro, depois Dólar, Euro e Rublo.
const AWESOME_PAIRS = [
  { pair: "BTC-BRL", key: "BTCBRL", symbol: "BTC", label: "Bitcoin", rank: 1 },
  { pair: "USD-BRL", key: "USDBRL", symbol: "USDBRL", label: "Dólar", rank: 2 },
  { pair: "EUR-BRL", key: "EURBRL", symbol: "EURBRL", label: "Euro", rank: 3 },
  { pair: "RUB-BRL", key: "RUBBRL", symbol: "RUBBRL", label: "Rublo", rank: 4 },
];

// Fallback de ações quando não há BRAPI_TOKEN (Yahoo v8, sem chave).
const YAHOO_STOCKS = [
  { ticker: "PETR4.SA", symbol: "PETR4", label: "Petrobras PN" },
  { ticker: "VALE3.SA", symbol: "VALE3", label: "Vale ON" },
  { ticker: "ITUB4.SA", symbol: "ITUB4", label: "Itaú Unibanco PN" },
  { ticker: "BBDC4.SA", symbol: "BBDC4", label: "Bradesco PN" },
  { ticker: "BBAS3.SA", symbol: "BBAS3", label: "Banco do Brasil ON" },
  { ticker: "B3SA3.SA", symbol: "B3SA3", label: "B3 ON" },
  { ticker: "WEGE3.SA", symbol: "WEGE3", label: "WEG ON" },
  { ticker: "MGLU3.SA", symbol: "MGLU3", label: "Magazine Luiza ON" },
];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// fetch com timeout — não trava o scheduler se a fonte pendurar.
async function fetchJson(url, { timeoutMs = 8000, headers = {} } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": "freelandoo-wallet", ...headers },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// Yahoo bloqueia UAs "de bot" com mais frequência — usa UA de navegador.
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// ---- Fontes individuais (cada uma devolve items[] ou []) --------------------

async function fetchStocks(token) {
  if (!token) return [];
  // quote/list ordenado por volume ≈ "ações mais vistas/negociadas do dia".
  const url = `${BRAPI_BASE}/quote/list?sortBy=volume&sortOrder=desc&limit=${STOCKS_LIMIT}&token=${token}`;
  const data = await fetchJson(url);
  const stocks = Array.isArray(data?.stocks) ? data.stocks : [];
  return stocks.map((s, i) => ({
    symbol: s.stock,
    kind: "stock",
    label: s.name || s.stock,
    price: num(s.close),
    change_pct: num(s.change),
    currency: "BRL",
    logo_url: s.logo || null,
    rank: i,
  }));
}

async function fetchIbovespa(token) {
  if (!token) return [];
  const url = `${BRAPI_BASE}/quote/%5EBVSP?token=${token}`; // ^BVSP
  const data = await fetchJson(url);
  const r = Array.isArray(data?.results) ? data.results[0] : null;
  if (!r) return [];
  return [
    {
      symbol: "^BVSP",
      kind: "quote",
      label: "Ibovespa",
      price: num(r.regularMarketPrice),
      change_pct: num(r.regularMarketChangePercent),
      currency: "pts",
      logo_url: null,
      rank: 0,
    },
  ];
}

// Cotações (Dólar, Euro, Rublo, Bitcoin) via AwesomeAPI — sem token, com
// variação diária. bid = preço atual; pctChange = variação % do dia.
async function fetchAwesomeQuotes() {
  const url = `${AWESOME_BASE}/${AWESOME_PAIRS.map((p) => p.pair).join(",")}`;
  const data = await fetchJson(url);
  const out = [];
  for (const p of AWESOME_PAIRS) {
    const o = data?.[p.key];
    if (!o) continue;
    out.push({
      symbol: p.symbol,
      kind: "quote",
      label: p.label,
      price: num(o.bid),
      change_pct: num(o.pctChange),
      currency: "BRL",
      logo_url: null,
      rank: p.rank,
    });
  }
  return out;
}

// ---- Fallbacks (AwesomeAPI 429 no Railway / sem BRAPI_TOKEN) -----------------

// BTC via CoinGecko — preço em BRL + variação 24h, sem chave.
async function fetchCoinGeckoBtc() {
  const url =
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=brl&include_24hr_change=true";
  const data = await fetchJson(url);
  const o = data?.bitcoin;
  if (!o) return [];
  return [
    {
      symbol: "BTC",
      kind: "quote",
      label: "Bitcoin",
      price: num(o.brl),
      change_pct: num(o.brl_24h_change),
      currency: "BRL",
      logo_url: null,
      rank: 1,
    },
  ];
}

// USD/EUR/RUB via open.er-api.com — base BRL invertida. Sem variação diária
// (change_pct null → o front mostra "—"); atualiza 1x/dia, suficiente como
// fallback quando a AwesomeAPI está rate-limitada.
async function fetchErApiCurrencies(missingSymbols) {
  const data = await fetchJson("https://open.er-api.com/v6/latest/BRL");
  const rates = data?.rates || {};
  const defs = [
    { symbol: "USDBRL", code: "USD", label: "Dólar", rank: 2 },
    { symbol: "EURBRL", code: "EUR", label: "Euro", rank: 3 },
    { symbol: "RUBBRL", code: "RUB", label: "Rublo", rank: 4 },
  ];
  const out = [];
  for (const d of defs) {
    if (!missingSymbols.includes(d.symbol)) continue;
    const r = num(rates[d.code]);
    if (!r || r <= 0) continue;
    out.push({
      symbol: d.symbol,
      kind: "quote",
      label: d.label,
      price: 1 / r,
      change_pct: null,
      currency: "BRL",
      logo_url: null,
      rank: d.rank,
    });
  }
  return out;
}

// Um ticker no Yahoo v8 chart → preço atual + variação vs fechamento anterior.
async function fetchYahooMeta(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
  const data = await fetchJson(url, { headers: { "User-Agent": BROWSER_UA } });
  const meta = data?.chart?.result?.[0]?.meta;
  const price = num(meta?.regularMarketPrice);
  const prev = num(meta?.chartPreviousClose);
  if (price == null) return null;
  const change = prev && prev > 0 ? ((price - prev) / prev) * 100 : null;
  return { price, change };
}

// Ações B3 fixas via Yahoo (fallback sem BRAPI_TOKEN). Best-effort por ticker.
async function fetchStocksYahoo() {
  const settled = await Promise.allSettled(
    YAHOO_STOCKS.map((s) => fetchYahooMeta(s.ticker))
  );
  const out = [];
  settled.forEach((res, i) => {
    if (res.status !== "fulfilled" || !res.value) return;
    out.push({
      symbol: YAHOO_STOCKS[i].symbol,
      kind: "stock",
      label: YAHOO_STOCKS[i].label,
      price: res.value.price,
      change_pct: res.value.change,
      currency: "BRL",
      logo_url: null,
      rank: i,
    });
  });
  return out;
}

async function fetchIbovespaYahoo() {
  const meta = await fetchYahooMeta("^BVSP");
  if (!meta) return [];
  return [
    {
      symbol: "^BVSP",
      kind: "quote",
      label: "Ibovespa",
      price: meta.price,
      change_pct: meta.change,
      currency: "pts",
      logo_url: null,
      rank: 0,
    },
  ];
}

// ---- Orquestração -----------------------------------------------------------

class MarketService {
  /** Lê o cache (usado pelo controller público). */
  static async getSnapshot() {
    return runWithLogs(log, "getSnapshot", () => ({}), async () => {
      const [snap, news] = await Promise.all([
        MarketStorage.getSnapshot(pool),
        MarketStorage.listNews(pool, 8),
      ]);
      return { ...snap, news };
    });
  }

  /**
   * Coleta todas as fontes e faz UPSERT. Chamado pelo scheduler do boot.
   * Best-effort: agrega o que cada fonte devolveu; ignora as que falharam.
   */
  static async refresh() {
    return runWithLogs(log, "refresh", () => ({}), async () => {
      const token = process.env.BRAPI_TOKEN || null;
      if (!token) {
        log.warn("refresh.no_brapi_token", {
          msg: "BRAPI_TOKEN ausente — ações e Ibovespa caem no fallback Yahoo Finance.",
        });
      }

      const primary = [
        ["awesome", () => fetchAwesomeQuotes()], // sem token (429 frequente no Railway)
        ["stocks", () => fetchStocks(token)],
        ["ibovespa", () => fetchIbovespa(token)],
      ];

      const items = [];
      const runSources = async (sources) => {
        const settled = await Promise.allSettled(sources.map(([, fn]) => fn()));
        settled.forEach((res, i) => {
          const name = sources[i][0];
          if (res.status === "fulfilled") {
            items.push(...res.value);
          } else {
            log.error("refresh.source_failed", { source: name, message: res.reason?.message });
          }
        });
      };

      await runSources(primary);

      // Fallbacks só pro que ficou faltando — não duplica nem gasta request à toa.
      const have = new Set(items.map((i) => i.symbol));
      const missingFx = ["USDBRL", "EURBRL", "RUBBRL"].filter((s) => !have.has(s));
      const fallbacks = [];
      if (!have.has("BTC")) fallbacks.push(["coingecko_btc", () => fetchCoinGeckoBtc()]);
      if (missingFx.length > 0) fallbacks.push(["er_api_fx", () => fetchErApiCurrencies(missingFx)]);
      if (!items.some((i) => i.kind === "stock")) fallbacks.push(["yahoo_stocks", () => fetchStocksYahoo()]);
      if (!have.has("^BVSP")) fallbacks.push(["yahoo_ibov", () => fetchIbovespaYahoo()]);

      if (fallbacks.length > 0) {
        await runSources(fallbacks);
      }

      if (items.length === 0) {
        return { updated: 0, skipped: true };
      }

      const updated = await MarketStorage.upsertMany(pool, items);
      return { updated };
    });
  }
}

module.exports = MarketService;
