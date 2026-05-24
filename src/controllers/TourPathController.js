const TourPathService = require("../services/TourPathService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class TourPathController {
  static async listActive(req, res) {
    const result = await TourPathService.listActive(req.user);
    return sendServiceResult(res, result);
  }

  static async getByKey(req, res) {
    const result = await TourPathService.getByKey(req.user, req.params.key);
    return sendServiceResult(res, result);
  }

  static async start(req, res) {
    const result = await TourPathService.transition(req.user, req.params.key, "start", req.body);
    return sendServiceResult(res, result);
  }

  static async progress(req, res) {
    const result = await TourPathService.transition(req.user, req.params.key, "progress", req.body);
    return sendServiceResult(res, result);
  }

  static async complete(req, res) {
    const result = await TourPathService.transition(req.user, req.params.key, "complete", req.body);
    return sendServiceResult(res, result);
  }

  static async skip(req, res) {
    const result = await TourPathService.transition(req.user, req.params.key, "skip", req.body);
    return sendServiceResult(res, result);
  }
}

module.exports = TourPathController;
