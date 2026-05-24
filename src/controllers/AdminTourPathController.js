const AdminTourPathService = require("../services/AdminTourPathService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class AdminTourPathController {
  static async listPaths(req, res) {
    return sendServiceResult(res, await AdminTourPathService.listPaths());
  }

  static async getPath(req, res) {
    return sendServiceResult(res, await AdminTourPathService.getPath(req.params.id));
  }

  static async createPath(req, res) {
    return sendServiceResult(res, await AdminTourPathService.createPath(req.body || {}, req.file), 201);
  }

  static async updatePath(req, res) {
    return sendServiceResult(res, await AdminTourPathService.updatePath(req.params.id, req.body || {}, req.file));
  }

  static async deletePath(req, res) {
    return sendServiceResult(res, await AdminTourPathService.deletePath(req.params.id));
  }

  static async uploadBanner(req, res) {
    return sendServiceResult(res, await AdminTourPathService.uploadBanner(req.file), 201);
  }

  static async listSteps(req, res) {
    return sendServiceResult(res, await AdminTourPathService.listSteps(req.params.id));
  }

  static async createStep(req, res) {
    return sendServiceResult(res, await AdminTourPathService.createStep(req.body || {}), 201);
  }

  static async updateStep(req, res) {
    return sendServiceResult(res, await AdminTourPathService.updateStep(req.params.id, req.body || {}));
  }

  static async deleteStep(req, res) {
    return sendServiceResult(res, await AdminTourPathService.deleteStep(req.params.id));
  }
}

module.exports = AdminTourPathController;
