// src/services/MarketService.js
//
// Coletor de mercado para o widget da Wallet. Roda NO BACKEND (Railway) via
// scheduler (index.js) e guarda o resultado em tb_market_snapshot. O frontend
// (Vercel) só lê o cache — nunca chama estas APIs externas (evita invocação
// serverless por request e rate-limit).
//
// Fontes:
//  - AwesomeAPI (grátis, sem chave): Dólar, Euro, Rublo e Bitcoin em BRL, já
//    com variação diária (pctChange). É a fonte das COTAÇÕES — funciona sempre.
//  - brapi.dev: ações mais negociadas (proxy de "mais vistas") e Ibovespa.
//    Exige BRAPI_TOKEN no env — sem token, só essas duas seções ficam vazias.
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
const AWESOME_PAIRS = [
  { pair: "USD-BRL", key: "USDBRL", symbol: "USDBRL", label: "Dólar", rank: 1 },
  { pair: "EUR-BRL", key: "EURBRL", symbol: "EURBRL", label: "Euro", rank: 2 },
  { pair: "RUB-BRL", key: "RUBBRL", symbol: "RUBBRL", label: "Rublo", rank: 3 },
  { pair: "BTC-BRL", key: "BTCBRL", symbol: "BTC", label: "Bitcoin", rank: 4 },
];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// fetch com timeout — não trava o scheduler se a fonte pendurar.
async function fetchJson(url, { timeoutMs = 8000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": "freelandoo-wallet" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

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
          msg: "BRAPI_TOKEN ausente — cotações (Dólar/Euro/Rublo/BTC) seguem via AwesomeAPI; só ações e Ibovespa ficam vazios.",
        });
      }

      const sources = [
        ["awesome", () => fetchAwesomeQuotes()], // sem token
        ["stocks", () => fetchStocks(token)],
        ["ibovespa", () => fetchIbovespa(token)],
      ];

      const settled = await Promise.allSettled(sources.map(([, fn]) => fn()));
      const items = [];
      settled.forEach((res, i) => {
        const name = sources[i][0];
        if (res.status === "fulfilled") {
          items.push(...res.value);
        } else {
          log.error("refresh.source_failed", { source: name, message: res.reason?.message });
        }
      });

      if (items.length === 0) {
        return { updated: 0, skipped: true };
      }

      const updated = await MarketStorage.upsertMany(pool, items);
      return { updated };
    });
  }
}

module.exports = MarketService;
