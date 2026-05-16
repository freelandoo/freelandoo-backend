const SupervisionService = require("../services/SupervisionService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class SupervisionController {
  // Códigos
  static async generateInvite(req, res) {
    const result = await SupervisionService.generateInvite(req.user);
    return sendServiceResult(res, result, 201);
  }

  static async listInvites(req, res) {
    const result = await SupervisionService.listInvites(req.user);
    return sendServiceResult(res, result, 200);
  }

  static async revokeInvite(req, res) {
    const result = await SupervisionService.revokeInvite(
      req.user,
      req.params.id_invite
    );
    return sendServiceResult(res, result, 200);
  }

  static async validateCode(req, res) {
    const result = await SupervisionService.validateCode(req.body);
    return sendServiceResult(res, result, 200);
  }

  // Painel do responsável
  static async listMinors(req, res) {
    const result = await SupervisionService.listMinors(req.user);
    return sendServiceResult(res, result, 200);
  }

  static async updatePermissions(req, res) {
    const result = await SupervisionService.updateMinorPermissions(
      req.user,
      req.params.minor_user_id,
      req.body
    );
    return sendServiceResult(res, result, 200);
  }

  static async setStatus(req, res) {
    const result = await SupervisionService.setMinorStatus(
      req.user,
      req.params.id_supervised,
      req.body?.status
    );
    return sendServiceResult(res, result, 200);
  }

  static async setMachine(req, res) {
    const result = await SupervisionService.setMinorMachine(
      req.user,
      req.params.minor_user_id,
      Number(req.params.id_machine),
      req.body?.allowed
    );
    return sendServiceResult(res, result, 200);
  }
}

module.exports = SupervisionController;
