const AffiliateService = require("../services/AffiliateService");

function handleError(res, err) {
  if (err instanceof AffiliateService.ServiceError) {
    return res.status(err.status).json({ error: err.message });
  }
  throw err;
}

class AffiliateController {
  static async getMe(req, res) {
    try {
      const result = await AffiliateService.getMe(req.user);
      return res.json(result);
    } catch (err) {
      return handleError(res, err);
    }
  }

  /**
   * GET /me/referral?source_context=&base_cents=
   * Quem me indicou e quanto de desconto o vínculo vale hoje. Alimenta o selo
   * que substitui o campo de cupom no checkout de itens da plataforma.
   */
  static async getMyReferral(req, res) {
    try {
      const pool = require("../databases");
      const ReferralPricingService = require("../services/ReferralPricingService");
      const result = await ReferralPricingService.summaryForUser(pool, req.user.id_user, {
        source_context: req.query?.source_context || null,
        base_cents: Number(req.query?.base_cents || 0),
      });
      return res.json(result);
    } catch (err) {
      return handleError(res, err);
    }
  }

  static async getMyShareCoupon(req, res) {
    try {
      const result = await AffiliateService.getMyShareCoupon(req.user);
      return res.json(result);
    } catch (err) {
      return handleError(res, err);
    }
  }

  static async updateMyPayoutInfo(req, res) {
    try {
      const result = await AffiliateService.updateMyPayoutInfo(req.user, req.body || {});
      return res.json(result);
    } catch (err) {
      return handleError(res, err);
    }
  }

  static async listMyConversions(req, res) {
    try {
      const result = await AffiliateService.listMyConversions(req.user, req.query);
      return res.json(result);
    } catch (err) {
      return handleError(res, err);
    }
  }
}

module.exports = AffiliateController;
