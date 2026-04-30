const CouponAdminService = require("../services/CouponAdminService");

function handleError(res, err) {
  if (err instanceof CouponAdminService.ServiceError || (err && typeof err.status === "number")) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  throw err;
}

class CouponAdminController {
  // Descontos (geral)
  static async getDiscountSettings(req, res) {
    try {
      return res.json(await CouponAdminService.getDiscountSettings());
    } catch (err) {
      return handleError(res, err);
    }
  }

  static async listDiscountSettings(req, res) {
    try {
      const items = await CouponAdminService.listDiscountSettings();
      return res.json({ items });
    } catch (err) {
      return handleError(res, err);
    }
  }

  static async createDiscountSettings(req, res) {
    try {
      const row = await CouponAdminService.createDiscountSettings(req.user, req.body || {});
      return res.status(201).json(row);
    } catch (err) {
      return handleError(res, err);
    }
  }

  // Comissões (geral)
  static async getCommissionSettings(req, res) {
    try {
      return res.json(await CouponAdminService.getCommissionSettings());
    } catch (err) {
      return handleError(res, err);
    }
  }

  static async createCommissionSettings(req, res) {
    try {
      const row = await CouponAdminService.createCommissionSettings(req.user, req.body || {});
      return res.status(201).json(row);
    } catch (err) {
      return handleError(res, err);
    }
  }

  // Cupom manual
  static async createManualCoupon(req, res) {
    try {
      const coupon = await CouponAdminService.createManualCoupon(req.user, req.body || {});
      return res.status(201).json(coupon);
    } catch (err) {
      return handleError(res, err);
    }
  }

  // Busca cupom
  static async searchCoupon(req, res) {
    try {
      const code = req.query.code || req.query.q;
      const data = await CouponAdminService.searchCoupon(code);
      return res.json(data);
    } catch (err) {
      return handleError(res, err);
    }
  }

  // Overrides por cupom
  static async upsertDiscountOverride(req, res) {
    try {
      const row = await CouponAdminService.upsertDiscountOverride(
        req.user,
        req.params.id_coupon,
        req.body || {}
      );
      return res.json(row);
    } catch (err) {
      return handleError(res, err);
    }
  }

  static async deleteDiscountOverride(req, res) {
    try {
      const row = await CouponAdminService.deleteDiscountOverride(req.user, req.params.id_coupon);
      return res.json(row);
    } catch (err) {
      return handleError(res, err);
    }
  }

  static async upsertCommissionOverride(req, res) {
    try {
      const row = await CouponAdminService.upsertCommissionOverride(
        req.user,
        req.params.id_coupon,
        req.body || {}
      );
      return res.json(row);
    } catch (err) {
      return handleError(res, err);
    }
  }

  static async deleteCommissionOverride(req, res) {
    try {
      const row = await CouponAdminService.deleteCommissionOverride(
        req.user,
        req.params.id_coupon
      );
      return res.json(row);
    } catch (err) {
      return handleError(res, err);
    }
  }
}

module.exports = CouponAdminController;
