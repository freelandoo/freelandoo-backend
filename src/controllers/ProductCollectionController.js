const ProductCollectionService = require("../services/ProductCollectionService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class ProductCollectionController {
  static async list(req, res) {
    return sendServiceResult(res, await ProductCollectionService.list(req.user, req.params));
  }
  static async create(req, res) {
    return sendServiceResult(res, await ProductCollectionService.create(req.user, req.params, req.body), 201);
  }
  static async update(req, res) {
    return sendServiceResult(res, await ProductCollectionService.update(req.user, req.params, req.body));
  }
  static async remove(req, res) {
    return sendServiceResult(res, await ProductCollectionService.remove(req.user, req.params));
  }
  static async reorder(req, res) {
    return sendServiceResult(res, await ProductCollectionService.reorder(req.user, req.params, req.body));
  }
  static async uploadCover(req, res) {
    return sendServiceResult(res, await ProductCollectionService.uploadCover(req.user, req.params, req.file));
  }
  static async removeCover(req, res) {
    return sendServiceResult(res, await ProductCollectionService.removeCover(req.user, req.params));
  }
}

module.exports = ProductCollectionController;
