const ManifestationService = require("../services/ManifestationService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class ManifestationController {
  static async listProducts(req, res) {
    res.set("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
    return sendServiceResult(res, await ManifestationService.listPublicCatalog());
  }

  static async getProduct(req, res) {
    res.set("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
    return sendServiceResult(res, await ManifestationService.getPublicProduct(req.params.id));
  }

  static async mine(req, res) {
    return sendServiceResult(res, await ManifestationService.getMine(req.user, req.query || {}));
  }

  static async checkoutPolens(req, res) {
    return sendServiceResult(res, await ManifestationService.checkoutWithPolens(req.user, req.body || {}), 201);
  }

  static async checkoutStripe(req, res) {
    return sendServiceResult(res, await ManifestationService.createStripeCheckout(req.user, req.body || {}), 201);
  }

  static async setProfileApply(req, res) {
    return sendServiceResult(
      res,
      await ManifestationService.setProfileApply(req.user, req.params.profileId, req.body || {})
    );
  }
}

module.exports = ManifestationController;
