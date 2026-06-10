const MarketService = require("../services/MarketService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class MarketController {
  // GET /market/snapshot — cache de cotações/ações/notícias. Público.
  // Cache-Control explícito: sem ele a edge da Vercel cacheava o proxy
  // por tempo indefinido e o widget ficava preso em dados velhos.
  // Dado se renova a cada 15 min no scheduler — 2 min de edge é suficiente.
  static async snapshot(req, res) {
    const result = await MarketService.getSnapshot();
    res.set("Cache-Control", "public, max-age=0, s-maxage=120, stale-while-revalidate=600");
    return sendServiceResult(res, result);
  }
}

module.exports = MarketController;
