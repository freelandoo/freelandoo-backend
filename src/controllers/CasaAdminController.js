const CasaParticipantService = require("../services/CasaParticipantService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class CasaAdminController {
  // Participantes
  static async list(req, res) {
    return sendServiceResult(res, await CasaParticipantService.adminList());
  }
  static async get(req, res) {
    return sendServiceResult(res, await CasaParticipantService.adminGet(req.params.id));
  }
  static async create(req, res) {
    return sendServiceResult(res, await CasaParticipantService.adminCreate(req.body || {}, req.file), 201);
  }
  static async update(req, res) {
    return sendServiceResult(res, await CasaParticipantService.adminUpdate(req.params.id, req.body || {}, req.file));
  }
  static async remove(req, res) {
    return sendServiceResult(res, await CasaParticipantService.adminDelete(req.params.id));
  }
  static async upload(req, res) {
    return sendServiceResult(res, await CasaParticipantService.adminUpload(req.file, req.body?.kind), 201);
  }

  // Jornada
  static async createJourney(req, res) {
    return sendServiceResult(res, await CasaParticipantService.adminCreateJourney(req.params.id, req.body || {}), 201);
  }
  static async updateJourney(req, res) {
    return sendServiceResult(res, await CasaParticipantService.adminUpdateJourney(req.params.itemId, req.body || {}));
  }
  static async deleteJourney(req, res) {
    return sendServiceResult(res, await CasaParticipantService.adminDeleteJourney(req.params.itemId));
  }

  // Segredos
  static async createSecret(req, res) {
    return sendServiceResult(res, await CasaParticipantService.adminCreateSecret(req.params.id, req.body || {}), 201);
  }
  static async updateSecret(req, res) {
    return sendServiceResult(res, await CasaParticipantService.adminUpdateSecret(req.params.itemId, req.body || {}));
  }
  static async deleteSecret(req, res) {
    return sendServiceResult(res, await CasaParticipantService.adminDeleteSecret(req.params.itemId));
  }

  // Teorias
  static async createTheory(req, res) {
    return sendServiceResult(res, await CasaParticipantService.adminCreateTheory(req.params.id, req.body || {}), 201);
  }
  static async updateTheory(req, res) {
    return sendServiceResult(res, await CasaParticipantService.adminUpdateTheory(req.params.itemId, req.body || {}));
  }
  static async deleteTheory(req, res) {
    return sendServiceResult(res, await CasaParticipantService.adminDeleteTheory(req.params.itemId));
  }

  // Produtos
  static async listProducts(req, res) {
    return sendServiceResult(res, await CasaParticipantService.adminListProducts(req.params.id));
  }
  static async createProduct(req, res) {
    return sendServiceResult(res, await CasaParticipantService.adminCreateProduct(req.params.id, req.body || {}, req.file), 201);
  }
  static async updateProduct(req, res) {
    return sendServiceResult(res, await CasaParticipantService.adminUpdateProduct(req.params.productId, req.body || {}, req.file));
  }
  static async deleteProduct(req, res) {
    return sendServiceResult(res, await CasaParticipantService.adminDeleteProduct(req.params.productId));
  }
}

module.exports = CasaAdminController;
