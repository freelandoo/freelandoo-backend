const ConversationService = require("../services/ConversationService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class ConversationController {
  static async list(req, res) {
    const result = await ConversationService.listMine(req.user, req.query || {});
    return sendServiceResult(res, result);
  }

  static async open(req, res) {
    const result = await ConversationService.openOrCreate(req.user, req.body || {});
    return sendServiceResult(res, result, 201);
  }

  static async detail(req, res) {
    const result = await ConversationService.getConversation(req.user, {
      id_conversation: req.params?.id,
      actor_id: req.query?.actor_id,
      actor_type: req.query?.actor_type,
    });
    return sendServiceResult(res, result);
  }

  static async listMessages(req, res) {
    const result = await ConversationService.listMessages(req.user, {
      id_conversation: req.params?.id,
      actor_id: req.query?.actor_id,
      actor_type: req.query?.actor_type,
      cursor: req.query?.cursor,
      limit: req.query?.limit,
    });
    return sendServiceResult(res, result);
  }

  static async sendMessage(req, res) {
    const result = await ConversationService.sendMessage(req.user, {
      ...(req.body || {}),
      id_conversation: req.params?.id || req.body?.id_conversation,
    });
    return sendServiceResult(res, result, 201);
  }

  static async sendAudioMessage(req, res) {
    const result = await ConversationService.sendAudioMessage(req.user, {
      id_conversation: req.params?.id,
      actor_id: req.body?.actor_id,
      actor_type: req.body?.actor_type,
      file: req.file,
    });
    return sendServiceResult(res, result, 201);
  }

  static async deleteMessage(req, res) {
    const result = await ConversationService.deleteMessage(req.user, {
      id_message: req.params?.id_message,
      actor_id: req.query?.actor_id || req.body?.actor_id,
      actor_type: req.query?.actor_type || req.body?.actor_type,
    });
    return sendServiceResult(res, result);
  }

  static async markRead(req, res) {
    const result = await ConversationService.markRead(req.user, {
      ...(req.body || {}),
      id_conversation: req.params?.id || req.body?.id_conversation,
    });
    return sendServiceResult(res, result);
  }

  static async unread(req, res) {
    const result = await ConversationService.unreadSummary(req.user);
    return sendServiceResult(res, result);
  }

  static async deleteConversation(req, res) {
    const result = await ConversationService.deleteConversation(req.user, {
      id_conversation: req.params?.id,
    });
    return sendServiceResult(res, result);
  }

  static async search(req, res) {
    const result = await ConversationService.searchMessageable(req.user, {
      q: req.query?.q,
      limit: req.query?.limit,
    });
    return sendServiceResult(res, result);
  }
}

module.exports = ConversationController;
