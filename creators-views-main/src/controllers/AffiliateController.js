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
