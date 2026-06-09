// src/services/MarketService.js
//
// Coletor de mercado para o widget da Wallet. Roda NO BACKEND (Railway) via
// scheduler (index.js) e guarda o resultado em tb_market_snapshot. O frontend
// (Vercel) só lê o cache — nunca chama estas APIs externas (evita invocação
// serverless por request e rate-limit).
//
// Fontes:
//  - brapi.dev: ações mais negociadas (proxy de "mais vistas"), Ibovespa,
//    Dólar e Euro. Exige BRAPI_TOKEN no env — sem token, pula sem quebrar.
//  - CoinGecko (grátis, sem chave): Bitcoin em BRL.
//
// Tudo é best-effort: cada fonte é isolada; falha de uma não afeta as outras
// nem o cache já existente (UPSERT só sobrescreve o que veio).

const pool = require("../databases");
const MarketStorage = require("../storages/MarketStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("MarketService");

const BRAPI_BASE = "https://brapi.dev/api";
const COINGECKO_BASE = "https://api.coingecko.com/api/v3";
const STOCKS_LIMIT = 8;

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

async function fetchCurrencies(token) {
  if (!token) return [];
  const url = `${BRAPI_BASE}/v2/currency?currency=USD-BRL,EUR-BRL&token=${token}`;
  const data = await fetchJson(url);
  const list = Array.isArray(data?.currency) ? data.currency : [];
  const byPair = (pair) => list.find((c) => (c.fromCurrency + c.toCurrency) === pair || c.name === pair);
  const out = [];
  const usd = byPair("USDBRL") || list.find((c) => c.fromCurrency === "USD");
  const eur = byPair("EURBRL") || list.find((c) => c.fromCurrency === "EUR");
  if (usd) {
    out.push({
      symbol: "USDBRL",
      kind: "quote",
      label: "Dólar",
      price: num(usd.bidPrice ?? usd.high ?? usd.askPrice),
      change_pct: num(usd.pctChange ?? usd.percentageChange),
      currency: "BRL",
      logo_url: null,
      rank: 1,
    });
  }
  if (eur) {
    out.push({
      symbol: "EURBRL",
      kind: "quote",
      label: "Euro",
      price: num(eur.bidPrice ?? eur.high ?? eur.askPrice),
      change_pct: num(eur.pctChange ?? eur.percentageChange),
      currency: "BRL",
      logo_url: null,
      rank: 2,
    });
  }
  return out;
}

async function fetchBitcoin() {
  const url = `${COINGECKO_BASE}/simple/price?ids=bitcoin&vs_currencies=brl&include_24hr_change=true`;
  const data = await fetchJson(url);
  const btc = data?.bitcoin;
  if (!btc) return [];
  return [
    {
      symbol: "BTC",
      kind: "quote",
      label: "Bitcoin",
      price: num(btc.brl),
      change_pct: num(btc.brl_24h_change),
      currency: "BRL",
      logo_url: null,
      rank: 3,
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
          msg: "BRAPI_TOKEN ausente — só Bitcoin (CoinGecko) será atualizado.",
        });
      }

      const sources = [
        ["stocks", () => fetchStocks(token)],
        ["ibovespa", () => fetchIbovespa(token)],
        ["currencies", () => fetchCurrencies(token)],
        ["bitcoin", () => fetchBitcoin()],
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
