const PortfolioFeedStorage = require("../../storages/PortfolioFeedStorage");
const { createLogger, runWithLogs } = require("../../utils/logger");
const { slugify, buildProfileUrl } = require("../../utils/slug");

const log = createLogger("PortfolioFeedService");

const MAX_LIMIT = 24;
const DEFAULT_LIMIT = 12;
const WHATSAPP_BASE = "https://wa.me/";

// Pool sizing — limites de quantos candidatos puxamos do banco antes de mixar.
// Mantém custo previsível mesmo quando a base cresce.
const TOP_POOL_FETCH = 300;
const NEW_POOL_FETCH = 200;

// Mistura 60/25/15: a cada 20 slots, 12 vêm do top, 5 do new, 3 do exploration.
const MIX_PATTERN = (() => {
  const arr = [];
  for (let i = 0; i < 12; i++) arr.push("T");
  for (let i = 0; i < 5; i++) arr.push("N");
  for (let i = 0; i < 3; i++) arr.push("E");
  return arr;
})();

// Boost de novidade: posts com <72h ganham score adicional decrescente.
const NOVELTY_HOURS = 72;
const BOOST_MAX = 30;

// Penalidade: posts muito impressionados com baixo engajamento perdem score.
const PENALTY_IMPRESSIONS = 2000;
const PENALTY_RATIO = 0.01;

const SEED_RE = /^[A-Za-z0-9]{6,16}$/;

// ──────────────────────────────────────────────────────────────────────────
// Cursor: "<seed>:<index>"
// ──────────────────────────────────────────────────────────────────────────
function generateSeed() {
  return (
    Math.random().toString(36).slice(2, 10) +
    Date.now().toString(36).slice(-4)
  );
}

function parseCursor(raw) {
  if (typeof raw !== "string" || !raw) return { seed: null, index: 0 };
  const idx = raw.indexOf(":");
  if (idx < 0) return { seed: null, index: 0 };
  const seed = raw.slice(0, idx);
  const index = parseInt(raw.slice(idx + 1), 10);
  if (!SEED_RE.test(seed)) return { seed: null, index: 0 };
  if (!Number.isFinite(index) || index < 0) return { seed: null, index: 0 };
  return { seed, index };
}

// ──────────────────────────────────────────────────────────────────────────
// PRNG determinístico baseado em seed string (mulberry32 + FNV-1a hash).
// ──────────────────────────────────────────────────────────────────────────
function hashSeed(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function makeRng(seed) {
  let a = hashSeed(seed) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ──────────────────────────────────────────────────────────────────────────
// Score composto: engagement_score + boost - penalidade.
// ──────────────────────────────────────────────────────────────────────────
function computeRankInfo(row, now) {
  const baseScore = Number(row.engagement_score) || 0;
  let score = baseScore;
  let isNew = false;

  if (row.published_at) {
    const ts = new Date(row.published_at).getTime();
    if (Number.isFinite(ts)) {
      const hours = (now - ts) / 3_600_000;
      if (hours < NOVELTY_HOURS) {
        isNew = true;
        score += (1 - hours / NOVELTY_HOURS) * BOOST_MAX;
      }
    }
  }

  const impressions = Number(row.impressions_count) || 0;
  const isUnderexposed = impressions < 200;

  if (
    impressions > PENALTY_IMPRESSIONS &&
    impressions > 0 &&
    baseScore / impressions < PENALTY_RATIO
  ) {
    score *= 0.5;
  }

  return { score, isNew, isUnderexposed };
}

// ──────────────────────────────────────────────────────────────────────────
// Particiona candidatos em 3 pools mutuamente exclusivos.
// ──────────────────────────────────────────────────────────────────────────
function buildPools(rows, rng) {
  const now = Date.now();

  // Anota cada row e ordena por score composto.
  const annotated = rows.map((row) => {
    const info = computeRankInfo(row, now);
    return { row, ...info };
  });
  annotated.sort((a, b) => b.score - a.score);

  // Top 60% pelo score — esses formam o pool top_engagement, em ordem.
  const total = annotated.length;
  const topSize = Math.max(1, Math.ceil(total * 0.6));
  const top = annotated.slice(0, topSize).map((x) => x.row);

  const remainder = annotated.slice(topSize);
  const newPool = [];
  const exploration = [];
  for (const item of remainder) {
    if (item.isNew || item.isUnderexposed) newPool.push(item.row);
    else exploration.push(item.row);
  }

  return {
    top,
    new: seededShuffle(newPool, rng),
    exploration: seededShuffle(exploration, rng),
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Mistura os 3 pools no padrão 60/25/15 para gerar a lista final ordenada.
// ──────────────────────────────────────────────────────────────────────────
function interleave(pools) {
  const cursors = { T: 0, N: 0, E: 0 };
  const sources = { T: pools.top, N: pools.new, E: pools.exploration };
  const ordered = [];
  let i = 0;
  // Termina quando todos os pools estão exauridos.
  while (
    cursors.T < sources.T.length ||
    cursors.N < sources.N.length ||
    cursors.E < sources.E.length
  ) {
    const tag = MIX_PATTERN[i % MIX_PATTERN.length];
    if (cursors[tag] < sources[tag].length) {
      ordered.push(sources[tag][cursors[tag]++]);
    } else {
      // Pool desejado vazio — pega do próximo não-vazio (T → E → N).
      const fallback = ["T", "E", "N"].find((k) => cursors[k] < sources[k].length);
      if (!fallback) break;
      ordered.push(sources[fallback][cursors[fallback]++]);
    }
    i++;
  }
  return ordered;
}

// ──────────────────────────────────────────────────────────────────────────
// Mantém apenas a primeira ocorrência de cada post_id (top tem prioridade).
// ──────────────────────────────────────────────────────────────────────────
function dedupeRows(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    if (!row?.post_id || seen.has(row.post_id)) continue;
    seen.add(row.post_id);
    out.push(row);
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// Shape do post para a API pública.
// ──────────────────────────────────────────────────────────────────────────
function shapeRow(row) {
  const machine = row.id_machine
    ? {
        id: row.id_machine,
        slug: row.machine_slug,
        name: row.machine_name,
        color_from: row.color_from,
        color_to: row.color_to,
        color_glow: row.color_glow,
        color_ring: row.color_ring,
        color_accent: row.color_accent,
        color_text: row.color_text,
      }
    : null;

  const profession = row.id_category
    ? {
        id: row.id_category,
        name: row.profession_name,
        slug: row.profession_slug,
      }
    : null;

  const profession_slug =
    row.profession_slug || (row.is_clan ? "clan" : null);
  const handle = row.username || "";
  const public_profile_url =
    profession_slug && handle
      ? buildProfileUrl({
          profession_slug,
          municipio: row.municipio,
          handle,
          sub_profile_slug: row.sub_profile_slug,
        })
      : null;

  const whatsapp_url = row.whatsapp_phone
    ? `${WHATSAPP_BASE}${row.whatsapp_phone}`
    : null;

  return {
    post_id: row.post_id,
    profile_id: row.id_profile,
    profile_name: row.display_name,
    avatar_url: row.avatar_url,
    username: row.username,
    is_clan: row.is_clan,
    sub_profile_slug: row.sub_profile_slug,
    machine,
    profession,
    city: row.municipio,
    state: row.estado,
    title: row.title,
    caption: row.description,
    media: row.media || [],
    likes_count: row.likes_count,
    shares_count: row.shares_count,
    impressions_count: row.impressions_count,
    profile_clicks_count: row.profile_clicks_count,
    whatsapp_clicks_count: row.whatsapp_clicks_count,
    social_clicks_count: row.social_clicks_count,
    engagement_score: Number(row.engagement_score) || 0,
    published_at: row.published_at,
    viewer_has_liked: !!row.viewer_has_liked,
    public_profile_url,
    whatsapp_url,
    social_links: row.social_links || [],
  };
}

class PortfolioFeedService {
  static async getFeed({ db, filters, pagination, viewer }) {
    return runWithLogs(
      log,
      "getFeed",
      () => ({
        ...filters,
        cursor: pagination?.cursor || null,
        limit: pagination?.limit,
        viewer: viewer?.id_user ? "auth" : "anon",
      }),
      async () => {
        const requestedLimit = Number.isFinite(pagination?.limit)
          ? pagination.limit
          : DEFAULT_LIMIT;
        const limit = Math.min(Math.max(requestedLimit, 1), MAX_LIMIT);

        const parsed = parseCursor(pagination?.cursor);
        const seed = parsed.seed || generateSeed();
        const startIndex = parsed.seed ? parsed.index : 0;

        const params = {
          id_machine: filters?.id_machine,
          id_category: filters?.id_category,
          estado: filters?.estado,
          municipio: filters?.municipio,
          level_min: filters?.level_min,
          exclude_ids: filters?.exclude_ids,
          viewer_id_user: viewer?.id_user || null,
        };

        const [topRows, newRows] = await Promise.all([
          PortfolioFeedStorage.listTopCandidates(db, {
            ...params,
            limit: TOP_POOL_FETCH,
          }),
          PortfolioFeedStorage.listNewCandidates(db, {
            ...params,
            limit: NEW_POOL_FETCH,
          }),
        ]);

        const candidates = dedupeRows([...topRows, ...newRows]);
        const rng = makeRng(seed);
        const pools = buildPools(candidates, rng);
        const ordered = interleave(pools);

        const slice = ordered.slice(startIndex, startIndex + limit);
        const items = slice.map(shapeRow);
        const nextIndex = startIndex + slice.length;
        const has_more = nextIndex < ordered.length;
        const next_cursor = has_more ? `${seed}:${nextIndex}` : null;

        return { items, next_cursor, has_more };
      }
    );
  }
}

module.exports = PortfolioFeedService;
module.exports.slugify = slugify;
module.exports._internal = {
  parseCursor,
  generateSeed,
  hashSeed,
  makeRng,
  buildPools,
  interleave,
  computeRankInfo,
};
