const FraudService = require("../services/FraudService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class FraudAdminController {
  static async dashboard(req, res) {
    const result = await FraudService.dashboard();
    return sendServiceResult(res, result, 200);
  }

  static async queue(req, res) {
    const result = await FraudService.listQueue({
      status: req.query.status,
      q: req.query.q,
      page: req.query.page,
      per_page: req.query.per_page,
    });
    return sendServiceResult(res, result, 200);
  }

  static async payoutMismatches(req, res) {
    const result = await FraudService.payoutMismatches();
    return sendServiceResult(res, result, 200);
  }

  static async detail(req, res) {
    const result = await FraudService.getCase(req.params.id_review);
    return sendServiceResult(res, result, 200);
  }

  static async decide(req, res) {
    const result = await FraudService.decide(req.user, {
      id_review: req.params.id_review,
      status: req.body?.status,
      notes: req.body?.notes,
    });
    return sendServiceResult(res, result, 200);
  }

  static async reevaluate(req, res) {
    const result = await FraudService.reevaluate(req.params.id_user);
    return sendServiceResult(res, result, 200);
  }
}

module.exports = FraudAdminController;
