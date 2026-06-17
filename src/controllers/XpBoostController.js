// src/controllers/XpBoostController.js
const XpBoostService = require("../services/XpBoostService");
const { sendServiceResult } = require("../utils/sendServiceResult");

module.exports = {
  async createCheckout(req, res) {
    const result = await XpBoostService.createCheckout(req.user, req.body || {});
    return sendServiceResult(res, result);
  },
};
