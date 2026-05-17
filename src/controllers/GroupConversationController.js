const GroupConversationService = require("../services/GroupConversationService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class GroupConversationController {
  static async create(req, res) {
    const result = await GroupConversationService.create(req.user, req.body || {});
    return sendServiceResult(res, result, 201);
  }

  static async listMembers(req, res) {
    const result = await GroupConversationService.listMembers(req.user, {
      id_conversation: req.params?.id,
    });
    return sendServiceResult(res, result);
  }

  static async addMembers(req, res) {
    const result = await GroupConversationService.addMembers(req.user, {
      id_conversation: req.params?.id,
      profile_ids: req.body?.profile_ids,
    });
    return sendServiceResult(res, result, 201);
  }

  static async leave(req, res) {
    const result = await GroupConversationService.leave(req.user, {
      id_conversation: req.params?.id,
    });
    return sendServiceResult(res, result);
  }
}

module.exports = GroupConversationController;
