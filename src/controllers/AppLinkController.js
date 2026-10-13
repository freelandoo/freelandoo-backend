const AppLinkService = require("../services/AppLinkService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class AppLinkController {
  static async createCode(req, res) {
    return sendServiceResult(res, await AppLinkService.createCode(req.user.id_user), 201);
  }

  static async exchange(req, res) {
    return sendServiceResult(res, await AppLinkService.exchange(req.body));
  }

  static async refresh(req, res) {
    return sendServiceResult(res, await AppLinkService.refresh(req.body));
  }

  static async logout(req, res) {
    return sendServiceResult(res, await AppLinkService.logout(req.body));
  }

  static async listSessions(req, res) {
    return sendServiceResult(res, await AppLinkService.listSessions(req.user.id_user));
  }

  static async revokeSession(req, res) {
    return sendServiceResult(
      res,
      await AppLinkService.revokeSession(req.user.id_user, req.params.id_app_session)
    );
  }
}

module.exports = AppLinkController;
