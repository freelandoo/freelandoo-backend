const ContentReferralService = require("../services/ContentReferralService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class ContentReferralController {
  /**
   * POST /me/affiliate/touch
   * body: { item_type, item_id, coupon_code, visitor_token? }
   *
   * Auth opcional — visitante deslogado grava pelo visitor_token.
   */
  static async touch(req, res) {
    const result = await ContentReferralService.touch({
      user: req.user || null,
      body: req.body || {},
    });
    return sendServiceResult(res, result);
  }
}

module.exports = ContentReferralController;
