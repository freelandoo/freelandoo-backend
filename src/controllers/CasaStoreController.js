const CasaStoreService = require("../services/CasaStoreService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class CasaStoreController {
  // Público: vitrine única (espelhada em toda página de participante)
  static async listPublic(req, res) {
    return sendServiceResult(res, await CasaStoreService.listPublic());
  }

  // Admin: produtos
  static async list(req, res) {
    return sendServiceResult(res, await CasaStoreService.adminList());
  }
  static async get(req, res) {
    return sendServiceResult(res, await CasaStoreService.adminGet(req.params.id));
  }
  static async create(req, res) {
    return sendServiceResult(res, await CasaStoreService.adminCreate(req.body || {}), 201);
  }
  static async update(req, res) {
    return sendServiceResult(res, await CasaStoreService.adminUpdate(req.params.id, req.body || {}));
  }
  static async remove(req, res) {
    return sendServiceResult(res, await CasaStoreService.adminDelete(req.params.id));
  }

  // Admin: mídia (galeria)
  static async addMedia(req, res) {
    return sendServiceResult(res, await CasaStoreService.adminAddMedia(req.params.id, req.file, req.body || {}), 201);
  }
  static async deleteMedia(req, res) {
    return sendServiceResult(res, await CasaStoreService.adminDeleteMedia(req.params.mediaId));
  }
  static async reorderMedia(req, res) {
    return sendServiceResult(res, await CasaStoreService.adminReorderMedia(req.params.id, req.body || {}));
  }

  // Admin: pedidos (com atribuição do participante)
  static async listOrders(req, res) {
    return sendServiceResult(res, await CasaStoreService.adminListOrders(req.query || {}));
  }
}

module.exports = CasaStoreController;
