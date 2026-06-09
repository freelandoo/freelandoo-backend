const MarketService = require("../services/MarketService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class MarketController {
  // GET /market/snapshot — cache de cotações/ações/notícias. Público.
  // O front cacheia este endpoint (ISR); aqui só lemos a tabela.
  static async snapshot(req, res) {
    const result = await MarketService.getSnapshot();
    return sendServiceResult(res, result);
  }
}

module.exports = MarketController;
