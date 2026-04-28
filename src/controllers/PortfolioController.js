const PortfolioService = require("../services/PortfolioService");
const PortfolioStorage = require("../storages/PortfolioStorage");
const UploadPortfolioMediaService = require("../services/portfolio/UploadPortfolioMediaService");
const pool = require("../databases");
const { sendServiceResult } = require("../utils/sendServiceResult");

class PortfolioController {
  static async getPublicItem(req, res) {
    const item = await PortfolioStorage.getPublicItemWithProfile(
      pool,
      req.params.id_portfolio_item
    );
    if (!item) return res.status(404).json({ error: "Item não encontrado" });
    return res.json(item);
  }

  static async listPublic(req, res) {
    const result = await PortfolioService.listPublic({
      ...req.params,
      id_user_viewer: req.user?.id_user ?? null,
    });
    return sendServiceResult(res, result);
  }

  static async createItem(req, res) {
    const result = await PortfolioService.createItem(
      req.user,
      req.params,
      req.body
    );
    return sendServiceResult(res, result, 201);
  }

  static async updateItem(req, res) {
    const result = await PortfolioService.updateItem(
      req.user,
      req.params,
      req.body
    );
    return sendServiceResult(res, result);
  }

  static async disableItem(req, res) {
    const result = await PortfolioService.disableItem(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async addMedia(req, res) {
    const result = await PortfolioService.addMedia(
      req.user,
      req.params,
      req.body
    );
    return sendServiceResult(res, result, 201);
  }

  static async disableMedia(req, res) {
    const result = await PortfolioService.disableMedia(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async uploadMedia(req, res) {
    const { id_user } = req.user;
    const result = await UploadPortfolioMediaService.execute({
      db: pool,
      id_user,
      params: req.params,
      body: req.body,
      file: req.file,
    });
    return res.status(201).json(result);
  }
}

module.exports = PortfolioController;
