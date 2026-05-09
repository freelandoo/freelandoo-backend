const ManifestationService = require("../services/ManifestationService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class ManifestationController {
  static async listProducts(req, res) {
    return sendServiceResult(res, await ManifestationService.listPublicCatalog());
  }

  static async getProduct(req, res) {
    return sendServiceResult(res, await ManifestationService.getPublicProduct(req.params.id));
  }
}

module.exports = ManifestationController;
