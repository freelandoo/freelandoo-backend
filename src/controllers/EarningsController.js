const EarningsService = require("../services/earnings/EarningsService");
const CouponSalesService = require("../services/earnings/CouponSalesService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class EarningsController {
  static async listMine(req, res) {
    const result = await EarningsService.list(req.user, req.query || {});
    return sendServiceResult(res, result);
  }

  static async listCouponSales(req, res) {
    const result = await CouponSalesService.list(req.user, req.query || {});
    return sendServiceResult(res, result);
  }

  static async series(req, res) {
    const result = await EarningsService.series(req.user, req.query || {});
    return sendServiceResult(res, result);
  }
}

module.exports = EarningsController;
