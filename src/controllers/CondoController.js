// src/controllers/CondoController.js
// Camada fina: todo guard de papel/privacidade mora nos services de condomínio.

const CondoService = require("../services/CondoService");
const CondoNoticeService = require("../services/CondoNoticeService");
const CommunityListingService = require("../services/CommunityListingService");
const CondoPollService = require("../services/CondoPollService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class CondoController {
  /* ------------------------------ estrutura ------------------------------ */

  static async getStructure(req, res) {
    const result = await CondoService.getStructure(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async updateAddress(req, res) {
    const result = await CondoService.updateAddress(req.user, req.params, req.body || {});
    return sendServiceResult(res, result);
  }

  static async createBlock(req, res) {
    const result = await CondoService.createBlock(req.user, req.params, req.body || {});
    return sendServiceResult(res, result, 201);
  }

  static async deleteBlock(req, res) {
    const result = await CondoService.deleteBlock(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async createUnit(req, res) {
    const result = await CondoService.createUnit(req.user, req.params, req.body || {});
    return sendServiceResult(res, result, 201);
  }

  static async createSpot(req, res) {
    const result = await CondoService.createSpot(req.user, req.params, req.body || {});
    return sendServiceResult(res, result, 201);
  }

  /* --------------------------- reivindicações ---------------------------- */

  static async claimUnit(req, res) {
    const result = await CondoService.claimUnit(req.user, req.params, req.body || {});
    return sendServiceResult(res, result, 201);
  }

  static async claimParking(req, res) {
    const result = await CondoService.claimParking(req.user, req.params, req.body || {});
    return sendServiceResult(res, result, 201);
  }

  static async listClaims(req, res) {
    const result = await CondoService.listClaims(req.user, req.params, req.query || {});
    return sendServiceResult(res, result);
  }

  static async listMyClaims(req, res) {
    const result = await CondoService.listMyClaims(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async decideClaim(req, res) {
    const result = await CondoService.decideClaim(req.user, req.params, req.body || {});
    return sendServiceResult(res, result);
  }

  static async release(req, res) {
    const result = await CondoService.release(req.user, req.params, req.body || {});
    return sendServiceResult(res, result);
  }

  /* -------------------------------- avisos ------------------------------- */

  static async listNotices(req, res) {
    const result = await CondoNoticeService.list(req.user, req.params, req.query || {});
    return sendServiceResult(res, result);
  }

  static async createNotice(req, res) {
    const result = await CondoNoticeService.create(req.user, req.params, req.body || {});
    return sendServiceResult(res, result, 201);
  }

  static async markNoticeRead(req, res) {
    const result = await CondoNoticeService.markRead(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async deleteNotice(req, res) {
    const result = await CondoNoticeService.remove(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async pinNotice(req, res) {
    const result = await CondoNoticeService.setPinned(req.user, req.params, req.body || {});
    return sendServiceResult(res, result);
  }

  /* ------------------------------- anúncios ------------------------------ */

  static async listListings(req, res) {
    const result = await CommunityListingService.list(req.user, req.params, req.query || {});
    return sendServiceResult(res, result);
  }

  static async getQuota(req, res) {
    const result = await CommunityListingService.getQuota(req.user, req.params, req.query || {});
    return sendServiceResult(res, result);
  }

  static async createListing(req, res) {
    const result = await CommunityListingService.create(req.user, req.params, req.body || {});
    return sendServiceResult(res, result, 201);
  }

  static async updateListing(req, res) {
    const result = await CommunityListingService.update(req.user, req.params, req.body || {});
    return sendServiceResult(res, result);
  }

  static async setListingStatus(req, res) {
    const result = await CommunityListingService.setStatus(req.user, req.params, req.body || {});
    return sendServiceResult(res, result);
  }

  // Mensalidade do anúncio (mig 252), no endereço legado `/condos/...` que o
  // front em cache ainda chama. Mesmo service da porta genérica.
  static async listingBillingCheckout(req, res) {
    const result = await CommunityListingService.createListingCheckout(
      req.user,
      req.params,
      req.body || {}
    );
    return sendServiceResult(res, result, 201);
  }

  static async listingBillingPolens(req, res) {
    const result = await CommunityListingService.payListingWithPolens(
      req.user,
      req.params,
      req.body || {}
    );
    return sendServiceResult(res, result, 201);
  }

  static async listingBillingCancel(req, res) {
    const result = await CommunityListingService.cancelListingSubscription(req.user, req.params);
    return sendServiceResult(res, result);
  }

  // A venda de vaga avulsa acabou com a mig 252 — 410 em vez de 404, para o
  // front antigo saber que a porta mudou de lugar e não que quebrou.
  static async slotGone(req, res) {
    return res.status(410).json({
      error:
        "A vitrine passou a cobrar mensalidade por anúncio. Pague o anúncio em " +
        "/listings/:id_listing/billing/checkout.",
    });
  }

  /* ------------------------------- enquetes ------------------------------ */

  static async listPolls(req, res) {
    const result = await CondoPollService.list(req.user, req.params, req.query || {});
    return sendServiceResult(res, result);
  }

  static async createPoll(req, res) {
    const result = await CondoPollService.create(req.user, req.params, req.body || {});
    return sendServiceResult(res, result, 201);
  }

  static async votePoll(req, res) {
    const result = await CondoPollService.vote(req.user, req.params, req.body || {});
    return sendServiceResult(res, result, 201);
  }

  static async closePoll(req, res) {
    const result = await CondoPollService.close(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async listPendingPolls(req, res) {
    const result = await CondoPollService.listPending(req.user);
    return sendServiceResult(res, result);
  }
}

module.exports = CondoController;
