"use strict";

const ChatService = require("../services/ChatService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class ChatController {
  static async machines(req, res) {
    const result = await ChatService.listUserMachines(req.user);
    return sendServiceResult(res, result);
  }

  static async unread(req, res) {
    const result = await ChatService.unreadSummary(req.user);
    return sendServiceResult(res, result);
  }

  static async join(req, res) {
    const result = await ChatService.joinRoom(req.user, req.body);
    return sendServiceResult(res, result);
  }

  static async heartbeat(req, res) {
    const result = await ChatService.heartbeat(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async leave(req, res) {
    const result = await ChatService.leaveRoom(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async listMessages(req, res) {
    const result = await ChatService.listMessages(req.user, req.params, req.query);
    return sendServiceResult(res, result);
  }

  static async sendMessage(req, res) {
    const result = await ChatService.sendMessage(req.user, req.params, req.body);
    return sendServiceResult(res, result);
  }

  static async deleteOwnMessage(req, res) {
    const result = await ChatService.deleteOwnMessage(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async reportMessage(req, res) {
    const result = await ChatService.reportMessage(req.user, req.params, req.body);
    return sendServiceResult(res, result);
  }
}

module.exports = ChatController;
