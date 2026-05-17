const ProfileProductOrderService = require("../services/ProfileProductOrderService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class ProfileProductOrderController {
  static async createCheckout(req, res) {
    const result = await ProfileProductOrderService.createCheckout(req.user, req.body || {});
    return sendServiceResult(res, result, 201);
  }

  static async listMyOrders(req, res) {
    const result = await ProfileProductOrderService.listMyOrders(req.user, req.query || {});
    return sendServiceResult(res, result);
  }

  static async listMySales(req, res) {
    const result = await ProfileProductOrderService.listMySales(req.user, req.query || {});
    return sendServiceResult(res, result);
  }

  static async getLabel(req, res) {
    const result = await ProfileProductOrderService.getLabelForSeller(req.user, req.params.id_order);
    return sendServiceResult(res, result);
  }
}

module.exports = ProfileProductOrderController;
