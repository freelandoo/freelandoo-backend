const PolenProductService = require("../services/PolenProductService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class PolenProductAdminController {
  static async listProducts(req, res) {
    return sendServiceResult(res, await PolenProductService.adminListProducts());
  }

  static async getProduct(req, res) {
    return sendServiceResult(res, await PolenProductService.adminGetProduct(req.params.id));
  }

  static async createProduct(req, res) {
    return sendServiceResult(
      res,
      await PolenProductService.adminCreateProduct(req.body || {}, req.file),
      201
    );
  }

  static async updateProduct(req, res) {
    return sendServiceResult(
      res,
      await PolenProductService.adminUpdateProduct(req.params.id, req.body || {}, req.file)
    );
  }

  static async deleteProduct(req, res) {
    return sendServiceResult(res, await PolenProductService.adminDeleteProduct(req.params.id));
  }

  static async uploadImage(req, res) {
    return sendServiceResult(res, await PolenProductService.adminUploadImage(req.file), 201);
  }
}

module.exports = PolenProductAdminController;
