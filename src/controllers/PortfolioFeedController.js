const pool = require("../databases");
const PortfolioFeedService = require("../services/portfolioFeed/PortfolioFeedService");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseExcludeIds(raw) {
  if (!raw) return null;
  const arr = Array.isArray(raw)
    ? raw
    : String(raw).split(",").map((s) => s.trim());
  const filtered = arr.filter((s) => UUID_RE.test(s));
  return filtered.length ? filtered : null;
}

function parseIntOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseLevelMin(raw) {
  if (raw == null || raw === "") return null;
  const value = String(raw).trim().toLowerCase();
  if (!value || value === "all" || value === "todos") return null;
  const parsed = Number(value);
  const allowed = new Set([1, 5, 10, 20, 30]);
  if (!Number.isInteger(parsed) || !allowed.has(parsed)) {
    const err = new Error("level_min inválido");
    err.statusCode = 400;
    throw err;
  }
  return parsed;
}

function resolveFeedKind(raw, fallback) {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (value === "feed" || value === "bees") return value;
  if (value === "all" || value === "todos") return null;
  return fallback;
}

function makeFeedHandler(defaultKind) {
  return async function feedHandler(req, res) {
    const { id_machine, id_category, estado, municipio, level_min, exclude_ids, cursor, limit, kind } =
      req.query;

    const data = await PortfolioFeedService.getFeed({
      db: pool,
      filters: {
        id_machine: parseIntOrNull(id_machine),
        id_category: parseIntOrNull(id_category),
        estado: estado ? String(estado).toUpperCase().slice(0, 2) : null,
        municipio: municipio || null,
        level_min: parseLevelMin(level_min),
        exclude_ids: parseExcludeIds(exclude_ids),
        feed_kind: resolveFeedKind(kind, defaultKind),
      },
      pagination: {
        limit: parseIntOrNull(limit),
        cursor: typeof cursor === "string" ? cursor : null,
      },
      viewer: req.user || null,
    });

    return res.status(200).json(data);
  };
}

class PortfolioFeedController {
  // /feed/portfolio — default agora é misto (feed + bees).
  static list = makeFeedHandler(null);
  // /feed/bees — força só bees.
  static listBees = makeFeedHandler("bees");
}

module.exports = PortfolioFeedController;
