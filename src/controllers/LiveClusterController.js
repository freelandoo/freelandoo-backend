// src/controllers/LiveClusterController.js
// Superfície do MEMBRO dos Clusters de Live (/live-clusters).
const LiveClusterService = require("../services/LiveClusterService");
const { sendServiceResult } = require("../utils/sendServiceResult");

module.exports = {
  // GET /live-clusters/mine
  async listMine(req, res) {
    const result = await LiveClusterService.listMine(req.user);
    return sendServiceResult(res, result);
  },

  // GET /live-clusters/:id_live_cluster
  async detail(req, res) {
    const result = await LiveClusterService.memberDetail(req.user, req.params);
    return sendServiceResult(res, result);
  },
};
