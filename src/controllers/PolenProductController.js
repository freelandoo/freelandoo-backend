const PolenProductService = require("../services/PolenProductService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class PolenProductController {
  static async listProducts(req, res) {
    return sendServiceResult(res, await PolenProductService.listPublic());
  }

  static async getProduct(req, res) {
    return sendServiceResult(res, await PolenProductService.getPublic(req.params.id));
  }

  static async checkout(req, res) {
    return sendServiceResult(
      res,
      await PolenProductService.createStripeCheckout(req.user, {
        product_id: req.params.id,
        // Origem da compra (whitelist no serviço): o jogo volta para o jogo.
        return_to: req.body?.return_to,
      })
    );
  }
}

module.exports = PolenProductController;
