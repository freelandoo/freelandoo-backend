const AffiliateService = require("../services/AffiliateService");
const AffiliatePayoutService = require("../services/AffiliatePayoutService");

function handleError(res, err) {
  if (
    err instanceof AffiliateService.ServiceError ||
    err instanceof AffiliatePayoutService.ServiceError ||
    (err && typeof err.status === "number")
  ) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  throw err;
}

class AffiliateAdminController {
  // Affiliates
  static async list(req, res) {
    try {
      const result = await AffiliateService.listAffiliates(req.query);
      return res.json(result);
    } catch (err) {
      return handleError(res, err);
    }
  }

  static async upsert(req, res) {
    try {
      const result = await AffiliateService.createOrUpdateAffiliate(req.user, req.body || {});
      return res.status(201).json(result);
    } catch (err) {
      return handleError(res, err);
    }
  }

  static async updateStatus(req, res) {
    try {
      const result = await AffiliateService.updateAffiliateStatus(
        req.user,
        req.params.id,
        req.body || {}
      );
      return res.json(result);
    } catch (err) {
      return handleError(res, err);
    }
  }

  // Settings (versionado)
  static async listSettings(req, res) {
    try {
      const items = await AffiliateService.listSettings();
      return res.json({ items });
    } catch (err) {
      return handleError(res, err);
    }
  }

  static async createSettings(req, res) {
    try {
      const row = await AffiliateService.createSettings(req.user, req.body || {});
      return res.status(201).json(row);
    } catch (err) {
      return handleError(res, err);
    }
  }

  // Coupon override
  static async upsertOverride(req, res) {
    try {
      const row = await AffiliateService.upsertCouponOverride(
        req.user,
        req.params.id_coupon,
        req.body || {}
      );
      return res.json(row);
    } catch (err) {
      return handleError(res, err);
    }
  }

  static async deleteOverride(req, res) {
    try {
      const row = await AffiliateService.deleteCouponOverride(req.user, req.params.id_coupon);
      return res.json(row);
    } catch (err) {
      return handleError(res, err);
    }
  }

  // Conversions
  static async listConversions(req, res) {
    try {
      const result = await AffiliateService.listConversionsAdmin(req.query);
      return res.json(result);
    } catch (err) {
      return handleError(res, err);
    }
  }

  // Governance
  static async overview(req, res) {
    try {
      const data = await AffiliateService.overview();
      return res.json(data);
    } catch (err) { return handleError(res, err); }
  }

  static async listAudit(req, res) {
    try {
      const items = await AffiliateService.listAudit(req.query);
      return res.json({ items });
    } catch (err) { return handleError(res, err); }
  }

  static async resolveDispute(req, res) {
    try {
      const row = await AffiliateService.resolveDispute(
        req.user,
        req.params.id_conversion,
        req.body || {}
      );
      return res.json(row);
    } catch (err) { return handleError(res, err); }
  }

  // Payouts
  static async listEligible(req, res) {
    try {
      const result = await AffiliatePayoutService.listEligible(req.query.id_affiliate);
      return res.json(result);
    } catch (err) { return handleError(res, err); }
  }

  static async listBatches(req, res) {
    try {
      const items = await AffiliatePayoutService.listBatches(req.query);
      return res.json({ items });
    } catch (err) { return handleError(res, err); }
  }

  static async getBatch(req, res) {
    try {
      const batch = await AffiliatePayoutService.getBatch(req.params.id_batch);
      return res.json(batch);
    } catch (err) { return handleError(res, err); }
  }

  static async createBatch(req, res) {
    try {
      const batch = await AffiliatePayoutService.createBatch(req.user, req.body || {});
      return res.status(201).json(batch);
    } catch (err) { return handleError(res, err); }
  }

  static async updateBatchStatus(req, res) {
    try {
      const batch = await AffiliatePayoutService.markStatus(
        req.user,
        req.params.id_batch,
        req.body || {}
      );
      return res.json(batch);
    } catch (err) { return handleError(res, err); }
  }
}

module.exports = AffiliateAdminController;
