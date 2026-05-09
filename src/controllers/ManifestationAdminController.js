const ManifestationService = require("../services/ManifestationService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class ManifestationAdminController {
  // Categories
  static async listCategories(req, res) {
    return sendServiceResult(res, await ManifestationService.adminListCategories());
  }

  static async createCategory(req, res) {
    return sendServiceResult(res, await ManifestationService.adminCreateCategory(req.body || {}), 201);
  }

  static async updateCategory(req, res) {
    return sendServiceResult(res, await ManifestationService.adminUpdateCategory(req.params.id, req.body || {}));
  }

  static async deleteCategory(req, res) {
    return sendServiceResult(res, await ManifestationService.adminDeleteCategory(req.params.id));
  }

  // Products
  static async listProducts(req, res) {
    return sendServiceResult(res, await ManifestationService.adminListProducts());
  }

  static async getProduct(req, res) {
    return sendServiceResult(res, await ManifestationService.adminGetProduct(req.params.id));
  }

  static async createProduct(req, res) {
    return sendServiceResult(
      res,
      await ManifestationService.adminCreateProduct(req.body || {}, req.file),
      201
    );
  }

  static async updateProduct(req, res) {
    return sendServiceResult(
      res,
      await ManifestationService.adminUpdateProduct(req.params.id, req.body || {}, req.file)
    );
  }

  static async deleteProduct(req, res) {
    return sendServiceResult(res, await ManifestationService.adminDeleteProduct(req.params.id));
  }

  static async featureProduct(req, res) {
    return sendServiceResult(res, await ManifestationService.adminFeatureProduct(req.params.id));
  }

  static async unfeatureProduct(req, res) {
    return sendServiceResult(res, await ManifestationService.adminUnfeatureProduct(req.params.id));
  }

  static async uploadBanner(req, res) {
    return sendServiceResult(res, await ManifestationService.adminUploadBanner(req.file), 201);
  }
}

module.exports = ManifestationAdminController;
