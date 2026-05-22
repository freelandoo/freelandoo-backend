const MeOfferingsService = require("../services/MeOfferingsService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class MeOfferingsController {
  static async list(req, res) {
    const result = await MeOfferingsService.list(req.user, {
      type: req.query?.type,
    });
    return sendServiceResult(res, result);
  }
}

module.exports = MeOfferingsController;
