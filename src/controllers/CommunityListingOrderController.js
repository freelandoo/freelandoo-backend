// src/controllers/CommunityListingOrderController.js
// Camada fina da VENDA na vitrine (mig 249). Todo guard (morador, flag, dono do
// pedido, janela da disputa) mora no service.
//
// ⚠️ A FILA E O VEREDITO DA DISPUTA SÃO DO ADMIN DA PLATAFORMA, e por isso as
// duas rotas passam por `roleMiddleware("Administrator")` — não pelo guard de
// morador. O síndico é vizinho dos dois lados: julgar o 302 contra o 501 é o
// tipo de poder que transforma o cargo num problema. (Difere do comprovante de
// residência da mig 206, que o síndico lê porque ali ele é a autoridade
// natural sobre quem mora no prédio.)

const CommunityListingOrderService = require("../services/CommunityListingOrderService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class CommunityListingOrderController {
  static async checkout(req, res) {
    const result = await CommunityListingOrderService.checkout(
      req.user,
      req.params,
      req.body || {}
    );
    return sendServiceResult(res, result, 201);
  }

  static async listMine(req, res) {
    const result = await CommunityListingOrderService.listMine(
      req.user,
      req.params,
      req.query || {}
    );
    return sendServiceResult(res, result);
  }

  static async markDelivered(req, res) {
    const result = await CommunityListingOrderService.markDelivered(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async confirm(req, res) {
    const result = await CommunityListingOrderService.confirm(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async openDispute(req, res) {
    const result = await CommunityListingOrderService.openDispute(
      req.user,
      req.params,
      req.body || {}
    );
    return sendServiceResult(res, result, 201);
  }

  /* ------------------------------ admin ---------------------------------- */

  static async listDisputes(req, res) {
    const result = await CommunityListingOrderService.listDisputes();
    return sendServiceResult(res, result);
  }

  static async decideDispute(req, res) {
    const result = await CommunityListingOrderService.decideDispute(
      req.user,
      req.params,
      req.body || {}
    );
    return sendServiceResult(res, result);
  }
}

module.exports = CommunityListingOrderController;
