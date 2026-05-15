const NotificationService = require("../services/NotificationService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class NotificationController {
  static async list(req, res) {
    const result = await NotificationService.list(req.user, req.query);
    return sendServiceResult(res, result);
  }

  static async unreadCount(req, res) {
    const result = await NotificationService.unreadCount(req.user);
    return sendServiceResult(res, result);
  }

  static async markAllRead(req, res) {
    const result = await NotificationService.markAllRead(req.user);
    return sendServiceResult(res, result);
  }

  static async markOneRead(req, res) {
    const result = await NotificationService.markOneRead(req.user, req.params);
    return sendServiceResult(res, result);
  }
}

module.exports = NotificationController;
