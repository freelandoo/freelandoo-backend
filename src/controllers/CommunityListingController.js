// src/controllers/CommunityListingController.js
// Camada fina das VITRINES territoriais (condomínio e bairro).
//
// ⚠️ NÃO HÁ `requireFeature` NAS ROTAS QUE CHEGAM AQUI, e a ausência é
// deliberada: a porta é genérica e serve as duas modalidades, então um gate
// fixo no router mandaria o kill-switch errado — desligar `condominio` fecharia
// a vitrine do bairro junto. Quem escolhe a flag certa é `territorialContext`,
// depois de descobrir a modalidade. Ver `utils/territorialCommunity.js`.
//
// O `CondoController` continua com os MESMOS handlers montados em `/condos/...`
// (o front em cache ainda os chama) e os dois caminhos entram no mesmo service.

const CommunityListingService = require("../services/CommunityListingService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class CommunityListingController {
  static async list(req, res) {
    const result = await CommunityListingService.list(req.user, req.params, req.query || {});
    return sendServiceResult(res, result);
  }

  static async quota(req, res) {
    const result = await CommunityListingService.getQuota(req.user, req.params, req.query || {});
    return sendServiceResult(res, result);
  }

  static async create(req, res) {
    const result = await CommunityListingService.create(req.user, req.params, req.body || {});
    return sendServiceResult(res, result, 201);
  }

  static async update(req, res) {
    const result = await CommunityListingService.update(req.user, req.params, req.body || {});
    return sendServiceResult(res, result);
  }

  static async setStatus(req, res) {
    const result = await CommunityListingService.setStatus(req.user, req.params, req.body || {});
    return sendServiceResult(res, result);
  }

  static async slotCheckout(req, res) {
    const result = await CommunityListingService.createSlotCheckout(
      req.user,
      req.params,
      req.body || {}
    );
    return sendServiceResult(res, result, 201);
  }

  static async slotPolens(req, res) {
    const result = await CommunityListingService.purchaseSlotWithPolens(
      req.user,
      req.params,
      req.body || {}
    );
    return sendServiceResult(res, result, 201);
  }
}

module.exports = CommunityListingController;
