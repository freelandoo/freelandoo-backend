// src/controllers/ExtMessagingController.js
const ExtMessagingService = require("../services/ExtMessagingService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class ExtMessagingController {
  static async me(req, res) {
    const result = await ExtMessagingService.me(req.apiConnection);
    return sendServiceResult(res, result);
  }

  static async setWebhook(req, res) {
    const result = await ExtMessagingService.setWebhook(req.apiConnection, req.body);
    return sendServiceResult(res, result);
  }

  static async listConversations(req, res) {
    const result = await ExtMessagingService.listConversations(req.apiConnection, req.query);
    return sendServiceResult(res, result);
  }

  static async listMessages(req, res) {
    const result = await ExtMessagingService.listMessages(req.apiConnection, req.params.id, req.query);
    return sendServiceResult(res, result);
  }

  static async sendMessage(req, res) {
    const result = await ExtMessagingService.sendMessage(req.apiConnection, req.params.id, req.body);
    return sendServiceResult(res, result, 201);
  }

  static async markRead(req, res) {
    const result = await ExtMessagingService.markRead(req.apiConnection, req.params.id);
    return sendServiceResult(res, result);
  }
}

module.exports = ExtMessagingController;
