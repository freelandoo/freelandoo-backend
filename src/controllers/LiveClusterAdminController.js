// src/controllers/LiveClusterAdminController.js
// Superfície do ADMIN dos Clusters de Live (/admin/live-clusters).
const LiveClusterService = require("../services/LiveClusterService");
const { sendServiceResult } = require("../utils/sendServiceResult");

module.exports = {
  // GET /admin/live-clusters
  async list(req, res) {
    const result = await LiveClusterService.adminList();
    return sendServiceResult(res, result);
  },

  // POST /admin/live-clusters
  async create(req, res) {
    const result = await LiveClusterService.adminCreate(req.user, req.body);
    return sendServiceResult(res, result, 201);
  },

  // GET /admin/live-clusters/:id_live_cluster
  async detail(req, res) {
    const result = await LiveClusterService.adminDetail(req.params);
    return sendServiceResult(res, result);
  },

  // PUT /admin/live-clusters/:id_live_cluster
  async update(req, res) {
    const result = await LiveClusterService.adminUpdate(req.params, req.body);
    return sendServiceResult(res, result);
  },

  // DELETE /admin/live-clusters/:id_live_cluster
  async remove(req, res) {
    const result = await LiveClusterService.adminDelete(req.params);
    return sendServiceResult(res, result);
  },

  // POST /admin/live-clusters/:id_live_cluster/members  { username }
  async addMember(req, res) {
    const result = await LiveClusterService.adminAddMember(req.params, req.body);
    return sendServiceResult(res, result, 201);
  },

  // DELETE /admin/live-clusters/:id_live_cluster/members/:id_user
  async removeMember(req, res) {
    const result = await LiveClusterService.adminRemoveMember(req.params);
    return sendServiceResult(res, result);
  },

  // POST /admin/live-clusters/:id_live_cluster/buttons  { label, color, sort_order? }
  async createButton(req, res) {
    const result = await LiveClusterService.adminCreateButton(req.params, req.body);
    return sendServiceResult(res, result, 201);
  },

  // PUT /admin/live-clusters/:id_live_cluster/buttons/:id_button
  async updateButton(req, res) {
    const result = await LiveClusterService.adminUpdateButton(req.params, req.body);
    return sendServiceResult(res, result);
  },

  // DELETE /admin/live-clusters/:id_live_cluster/buttons/:id_button
  async removeButton(req, res) {
    const result = await LiveClusterService.adminDeleteButton(req.params);
    return sendServiceResult(res, result);
  },

  // POST /admin/live-clusters/:id_live_cluster/start
  async start(req, res) {
    const result = await LiveClusterService.adminStart(req.params);
    return sendServiceResult(res, result);
  },

  // POST /admin/live-clusters/:id_live_cluster/end
  async end(req, res) {
    const result = await LiveClusterService.adminEnd(req.params);
    return sendServiceResult(res, result);
  },

  // POST /admin/live-clusters/:id_live_cluster/signal  { kind: 'button'|'text', ... }
  async signal(req, res) {
    const result = await LiveClusterService.adminSignal(req.user, req.params, req.body);
    return sendServiceResult(res, result);
  },
};
