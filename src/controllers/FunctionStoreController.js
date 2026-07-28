// src/controllers/FunctionStoreController.js
const FunctionStoreService = require("../services/FunctionStoreService");
const { sendServiceResult } = require("../utils/sendServiceResult");

module.exports = {
  async listProducts(req, res) {
    const result = await FunctionStoreService.listProducts();
    return sendServiceResult(res, result);
  },

  async getProduct(req, res) {
    const result = await FunctionStoreService.getProduct(String(req.params.key || ""));
    return sendServiceResult(res, result);
  },

  async createCheckout(req, res) {
    const result = await FunctionStoreService.createCheckout(
      req.user,
      String(req.params.key || "")
    );
    return sendServiceResult(res, result);
  },
};
