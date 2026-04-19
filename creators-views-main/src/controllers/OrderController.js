const OrderService = require("../services/OrderService");

class OrderController {
  static async getOrderById(req, res) {
    const result = await OrderService.getOrderById(req.user, req.params);
    return res.json(result);
  }

  static async listMyOrders(req, res) {
    const result = await OrderService.listMyOrders(req.user, req.query);
    return res.json(result);
  }

  static async cancelOrder(req, res) {
    const result = await OrderService.cancelOrder(req.user, req.params);
    return res.json(result);
  }
}

module.exports = OrderController;
