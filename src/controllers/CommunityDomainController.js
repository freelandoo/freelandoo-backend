const CommunityDomainService = require("../services/CommunityDomainService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class CommunityDomainController {
  static async list(req, res) {
    const result = await CommunityDomainService.list(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async create(req, res) {
    const result = await CommunityDomainService.create(
      req.user,
      req.params,
      req.body || {}
    );
    return sendServiceResult(res, result, 201);
  }

  static async verify(req, res) {
    const result = await CommunityDomainService.verify(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async refresh(req, res) {
    const result = await CommunityDomainService.refresh(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async remove(req, res) {
    const result = await CommunityDomainService.remove(req.user, req.params);
    return sendServiceResult(res, result);
  }

  /**
   * Porta pública de roteamento: o middleware do front pergunta "de quem é este
   * Host?". Sem sessão — quem chega por domínio próprio não tem sessão nossa.
   */
  static async resolveHost(req, res) {
    const result = await CommunityDomainService.resolveHost(req.query);
    return sendServiceResult(res, result);
  }
}

module.exports = CommunityDomainController;
