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

class PortfolioFeedController {
  static async list(req, res) {
    const { id_machine, id_category, estado, municipio, exclude_ids, cursor, limit } =
      req.query;

    const data = await PortfolioFeedService.getFeed({
      db: pool,
      filters: {
        id_machine: parseIntOrNull(id_machine),
        id_category: parseIntOrNull(id_category),
        estado: estado ? String(estado).toUpperCase().slice(0, 2) : null,
        municipio: municipio || null,
        exclude_ids: parseExcludeIds(exclude_ids),
      },
      pagination: {
        limit: parseIntOrNull(limit),
        cursor: typeof cursor === "string" ? cursor : null,
      },
      viewer: req.user || null,
    });

    return res.status(200).json(data);
  }
}

module.exports = PortfolioFeedController;
