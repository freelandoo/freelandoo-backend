const CheckoutService = require("../services/CheckoutService");

class CheckoutController {
  static async createCheckout(req, res) {
    const result = await CheckoutService.createCheckout(req.user, req.body);
    return res.status(201).json(result);
  }

  static async getCheckoutById(req, res) {
    const result = await CheckoutService.getCheckoutById(req.user, req.params);
    return res.json(result);
  }

  static async applyCoupon(req, res) {
    const result = await CheckoutService.applyCoupon(
      req.user,
      req.params,
      req.body
    );
    return res.json(result);
  }

  static async removeCoupon(req, res) {
    const result = await CheckoutService.removeCoupon(req.user, req.params);
    return res.json(result);
  }

  static async confirmCheckout(req, res) {
    const result = await CheckoutService.confirmCheckout(
      req.user,
      req.params,
      req.body
    );
    return res.json(result);
  }

  static async cancelCheckout(req, res) {
    const result = await CheckoutService.cancelCheckout(req.user, req.params);
    return res.json(result);
  }
}

module.exports = CheckoutController;
