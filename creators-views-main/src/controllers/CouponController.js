const CouponService = require("../services/CouponService");

class CouponController {
  static async create(req, res) {
    const result = await CouponService.create(req.user);
    return res.status(201).json(result);
  }

  static async getUserCoupon(req, res) {
    const result = await CouponService.listByUser(req.user, req.query);
    return res.json(result);
  }

  static async validate(req, res) {
    const result = await CouponService.validateCoupon(req.body);
    return res.json(result);
  }
}

module.exports = CouponController;
