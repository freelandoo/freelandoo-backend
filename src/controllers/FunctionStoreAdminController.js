// src/controllers/FunctionStoreAdminController.js
const FunctionStoreService = require("../services/FunctionStoreService");
const { sendServiceResult } = require("../utils/sendServiceResult");

module.exports = {
  async listProducts(req, res) {
    const result = await FunctionStoreService.adminListProducts();
    return sendServiceResult(res, result);
  },

  async updateProduct(req, res) {
    const result = await FunctionStoreService.adminUpdateProduct(
      req.params.id,
      req.body || {},
      req.file || null
    );
    return sendServiceResult(res, result);
  },

  async listPurchases(req, res) {
    const result = await FunctionStoreService.adminListPurchases(req.query || {});
    return sendServiceResult(res, result);
  },

  async grant(req, res) {
    const result = await FunctionStoreService.adminGrant(req.body || {});
    return sendServiceResult(res, result);
  },

  async revoke(req, res) {
    const result = await FunctionStoreService.adminRevoke(req.body || {});
    return sendServiceResult(res, result);
  },
};
