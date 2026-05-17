const ProductRequestService = require("../services/ProductRequestService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class ProductRequestController {
  static async create(req, res) {
    const result = await ProductRequestService.create(req.user, req.body, req.file);
    return sendServiceResult(res, result, 201);
  }

  static async listMine(req, res) {
    const result = await ProductRequestService.listMine(req.user);
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

  static async close(req, res) {
    const result = await ProductRequestService.close(req.user, req.params.id);
    return sendServiceResult(res, result);
  }
}

module.exports = ProductRequestController;
