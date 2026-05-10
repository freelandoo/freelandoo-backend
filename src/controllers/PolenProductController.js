const PolenProductService = require("../services/PolenProductService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class PolenProductController {
  static async listProducts(req, res) {
    return sendServiceResult(res, await PolenProductService.listPublic());
  }

  static async getProduct(req, res) {
    return sendServiceResult(res, await PolenProductService.getPublic(req.params.id));
  }
}

module.exports = PolenProductController;
