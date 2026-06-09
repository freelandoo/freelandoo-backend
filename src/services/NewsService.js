// src/services/NewsService.js
//
// Coletor de manchetes de economia/política (BR) para a seção de notícias da
// Wallet. Roda NO BACKEND (Railway) via scheduler e guarda em tb_market_news.
// O frontend só lê o cache via /market/snapshot.
//
// Sem dependência externa: parser de RSS próprio (regex + decode de entidades),
// suficiente para os feeds usados. Sem chave/token — feeds públicos.

const pool = require("../databases");
const MarketStorage = require("../storages/MarketStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("NewsService");

// Fontes (RSS público). category alimenta o filtro visual economia | politica.
// G1 entrega itens completos com thumbnail (media:content). InfoMoney foi
// removido: o feed público vem vazio (só cabeçalho do channel) para bots.
// Para somar fontes no futuro, basta adicionar { url, source, category } aqui.
const FEEDS = [
  { url: "https://g1.globo.com/rss/g1/economia/", source: "G1 Economia", category: "economia" },
  { url: "https://g1.globo.com/dynamo/economia/agronegocios/rss2.xml", source: "G1 Agro", category: "economia" },
  { url: "https://g1.globo.com/rss/g1/politica/", source: "G1 Política", category: "politica" },
];

const PER_FEED = 8; // manchetes por feed por ciclo

// ---- parsing helpers --------------------------------------------------------

function decodeEntities(str) {
  if (!str) return "";
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&")
    .trim();
}

function pick(re, block) {
  const m = block.match(re);
  return m ? decodeEntities(m[1]) : null;
}

function pickAttr(re, block) {
  const m = block.match(re);
  return m ? decodeEntities(m[1]) : null;
}

function extractThumb(block) {
  // media:content / media:thumbnail / enclosure de imagem
  return (
    pickAttr(/<media:content[^>]*\burl="([^"]+)"[^>]*>/i, block) ||
    pickAttr(/<media:thumbnail[^>]*\burl="([^"]+)"/i, block) ||
    pickAttr(/<enclosure[^>]*\burl="([^"]+)"[^>]*type="image/i, block) ||
    // primeira <img> dentro de description/content:encoded
    pickAttr(/<img[^>]*\bsrc="([^"]+)"/i, block) ||
    null
  );
}

function parseRss(xml, feed) {
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const block of blocks.slice(0, PER_FEED)) {
    const title = pick(/<title>([\s\S]*?)<\/title>/i, block);
    // <link>...</link> (RSS) — alguns feeds usam <link/> Atom, mas RSS basta aqui
    let url = pick(/<link>([\s\S]*?)<\/link>/i, block);
    if (!url) url = pickAttr(/<link[^>]*\bhref="([^"]+)"/i, block);
    const pubRaw = pick(/<pubDate>([\s\S]*?)<\/pubDate>/i, block) ||
      pick(/<dc:date>([\s\S]*?)<\/dc:date>/i, block);
    let published_at = null;
    if (pubRaw) {
      const d = new Date(pubRaw);
      if (!Number.isNaN(d.getTime())) published_at = d.toISOString();
    }
    const thumb_url = extractThumb(block);
    if (title && url) {
      items.push({
        source: feed.source,
        category: feed.category,
        title,
        url: url.trim(),
        thumb_url,
        published_at,
      });
    }
  }
  return items;
}

async function fetchText(url, { timeoutMs = 8000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "freelandoo-wallet/1.0 (+https://freelandoo.com.br)",
        Accept: "application/rss+xml, application/xml, text/xml, */*",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

// ---- orquestração -----------------------------------------------------------

class NewsService {
  /**
   * Puxa todos os feeds, faz UPSERT e purga manchetes > 7 dias.
   * Best-effort: feed que falhar é ignorado, os demais entram.
   */
  static async refresh() {
    return runWithLogs(log, "refresh", () => ({ feeds: FEEDS.length }), async () => {
      const settled = await Promise.allSettled(
        FEEDS.map(async (feed) => parseRss(await fetchText(feed.url), feed))
      );

      const items = [];
      settled.forEach((res, i) => {
        if (res.status === "fulfilled") {
          items.push(...res.value);
        } else {
          log.error("refresh.feed_failed", { feed: FEEDS[i].url, message: res.reason?.message });
        }
      });

      if (items.length === 0) return { upserted: 0, skipped: true };

      const upserted = await MarketStorage.upsertNews(pool, items);
      const pruned = await MarketStorage.pruneNews(pool, 7);
      return { upserted, pruned };
    });
  }
}

module.exports = NewsService;
