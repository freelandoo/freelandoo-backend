const ProductCategoryService = require("../services/ProductCategoryService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class ProductCategoryController {
  static async listPublic(req, res) {
    const result = await ProductCategoryService.listPublic();
    return sendServiceResult(res, result);
  }

  static async listAdmin(req, res) {
    const result = await ProductCategoryService.listAdmin();
    return sendServiceResult(res, result);
  }

  static async getById(req, res) {
    const result = await ProductCategoryService.getById(req.params.id);
    return sendServiceResult(res, result);
  }

  static async create(req, res) {
    const result = await ProductCategoryService.create(req.user, req.body);
    return sendServiceResult(res, result, 201);
  }

  static async update(req, res) {
    const result = await ProductCategoryService.update(req.user, req.params.id, req.body);
    return sendServiceResult(res, result);
  }

  static async remove(req, res) {
    const result = await ProductCategoryService.remove(req.user, req.params.id);
    return sendServiceResult(res, result);
  }
}

module.exports = ProductCategoryController;
