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

  /* ------------------------------ mensalidade ---------------------------- */

  //
  // ⚠️ ESTE CHECKOUT É O DONO PAGANDO O ESPAÇO — não confundir com o
  // `/listings/:id_listing/checkout` do `CommunityListingOrderController`, que
  // é o VIZINHO COMPRANDO o produto anunciado. São dois pagamentos opostos
  // sobre o mesmo anúncio, e por isso a mensalidade mora sob `/billing`.
  static async billingCheckout(req, res) {
    const result = await CommunityListingService.createListingCheckout(
      req.user,
      req.params,
      req.body || {}
    );
    return sendServiceResult(res, result, 201);
  }

  static async billingPolens(req, res) {
    const result = await CommunityListingService.payListingWithPolens(
      req.user,
      req.params,
      req.body || {}
    );
    return sendServiceResult(res, result, 201);
  }

  static async billingCancel(req, res) {
    const result = await CommunityListingService.cancelListingSubscription(req.user, req.params);
    return sendServiceResult(res, result);
  }

  //
  // A venda de VAGA da mig 198 acabou com a mig 252: o que se paga agora é a
  // mensalidade de um anúncio específico, e a vaga avulsa não tem mais o que
  // significar.
  //
  // ⚠️ 410 E NÃO 404, e a rota continua montada: quem bate aqui é front antigo
  // em cache ainda desenhando o botão "comprar vaga extra". "Esta porta não
  // existe mais" é a única resposta que explica a tela — um 404 pareceria bug.
  static async slotGone(req, res) {
    return res.status(410).json({
      error:
        "A vitrine passou a cobrar mensalidade por anúncio. Pague o anúncio em " +
        "/listings/:id_listing/billing/checkout.",
    });
  }
}

module.exports = CommunityListingController;
