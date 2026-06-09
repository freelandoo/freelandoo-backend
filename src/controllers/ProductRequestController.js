const ProductRequestService = require("../services/ProductRequestService");
const ProductRequestMatchingService = require("../services/ProductRequestMatchingService");
const ProductRequestResponseService = require("../services/ProductRequestResponseService");
const ProfileStorage = require("../storages/ProfileStorage");
const pool = require("../databases");
const { sendServiceResult } = require("../utils/sendServiceResult");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class ProductRequestController {
  static async create(req, res) {
    const result = await ProductRequestService.create(req.user, req.body, req.file);
    return sendServiceResult(res, result, 201);
  }

  static async listMine(req, res) {
    const result = await ProductRequestService.listMine(req.user);
    return sendServiceResult(res, result);
  }

  static async listMySent(req, res) {
    const result = await ProductRequestService.listMySentResponses(req.user);
    return sendServiceResult(res, result);
  }

  static async getById(req, res) {
    const result = await ProductRequestService.getById(req.user, req.params.id);
    return sendServiceResult(res, result);
  }

  static async cancel(req, res) {
    const result = await ProductRequestService.cancel(req.user, req.params.id);
    return sendServiceResult(res, result);
  }

  static async hide(req, res) {
    const result = await ProductRequestService.hide(req.user, req.params.id);
    return sendServiceResult(res, result);
  }

  static async close(req, res) {
    const result = await ProductRequestService.close(req.user, req.params.id);
    return sendServiceResult(res, result);
  }

  // ─── Mural do subperfil (vendedor) ─────────────────────────────────────
  static async muralForProfile(req, res) {
    const user = req.user;
    if (!user?.id_user) return res.status(401).json({ error: "Não autenticado" });
    const id_profile = req.query?.id_profile;
    if (!id_profile || !UUID_RE.test(String(id_profile))) {
      return res.status(400).json({ error: "id_profile inválido" });
    }
    const profile = await ProfileStorage.getProfileById(pool, id_profile);
    if (!profile) return res.status(404).json({ error: "Perfil não encontrado" });
    if (String(profile.id_user) !== String(user.id_user)) {
      return res.status(403).json({ error: "Sem permissão" });
    }
    const items = await ProductRequestMatchingService.listMuralForProfile(id_profile);
    return res.json({ items });
  }

  static async eligibleProducts(req, res) {
    const user = req.user;
    if (!user?.id_user) return res.status(401).json({ error: "Não autenticado" });
    const id_profile = req.query?.id_profile;
    const id_product_request = req.params.id;
    if (!id_profile || !UUID_RE.test(String(id_profile))) {
      return res.status(400).json({ error: "id_profile inválido" });
    }
    const profile = await ProfileStorage.getProfileById(pool, id_profile);
    if (!profile) return res.status(404).json({ error: "Perfil não encontrado" });
    if (String(profile.id_user) !== String(user.id_user)) {
      return res.status(403).json({ error: "Sem permissão" });
    }
    const products = await ProductRequestMatchingService.listEligibleProductsForRequest(
      id_profile, id_product_request,
    );
    return res.json({ products });
  }

  // ─── Respostas ─────────────────────────────────────────────────────────
  static async createResponse(req, res) {
    const result = await ProductRequestResponseService.create(req.user, req.params.id, req.body);
    return sendServiceResult(res, result, 201);
  }

  static async listResponses(req, res) {
    const result = await ProductRequestResponseService.listByRequest(req.user, req.params.id);
    return sendServiceResult(res, result);
  }

  // ─── Conversa (O.S.) ─────────────────────────────────────────────────────
  static async openConversation(req, res) {
    const result = await ProductRequestResponseService.openConversation(req.user, req.params.id, req.body || {});
    return sendServiceResult(res, result, 201);
  }

  static async listMyChats(req, res) {
    const result = await ProductRequestResponseService.listMyChats(req.user);
    return sendServiceResult(res, result);
  }

  static async listMyProChats(req, res) {
    const result = await ProductRequestResponseService.listMyProChats(req.user);
    return sendServiceResult(res, result);
  }

  static async messages(req, res) {
    const result = await ProductRequestResponseService.listMessages(req.user, req.params.id_response);
    return sendServiceResult(res, result);
  }

  static async sendMessage(req, res) {
    const result = await ProductRequestResponseService.sendMessage(req.user, req.params.id_response, req.body || {});
    return sendServiceResult(res, result, 201);
  }

  static async markRead(req, res) {
    const result = await ProductRequestResponseService.markRead(req.user, req.params.id_response);
    return sendServiceResult(res, result);
  }
}

module.exports = ProductRequestController;
