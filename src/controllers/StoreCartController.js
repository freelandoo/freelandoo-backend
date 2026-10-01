const StoreCartService = require("../services/StoreCartService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class StoreCartController {
  static async checkout(req, res) {
    return sendServiceResult(res, await StoreCartService.createCheckout(req.user || null, req.body || {}), 201);
  }
  static async getPublic(req, res) {
    return sendServiceResult(res, await StoreCartService.getPublic(req.params));
  }
}

module.exports = StoreCartController;
