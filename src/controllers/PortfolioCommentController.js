const PortfolioCommentService = require("../services/PortfolioCommentService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class PortfolioCommentController {
  static async list(req, res) {
    const result = await PortfolioCommentService.list({
      id_portfolio_item: req.params.id_portfolio_item,
      cursor: req.query.cursor,
      limit: req.query.limit,
      viewer: req.user || null,
    });
    return sendServiceResult(res, result);
  }

  static async like(req, res) {
    const result = await PortfolioCommentService.toggleLike({
      user: req.user,
      id_portfolio_comment: req.params.id_portfolio_comment,
    });
    return sendServiceResult(res, result);
  }

  static async create(req, res) {
    const result = await PortfolioCommentService.create({
      user: req.user,
      id_portfolio_item: req.params.id_portfolio_item,
      content: req.body?.content,
    });
    return sendServiceResult(res, result, 201);
  }

  static async remove(req, res) {
    const result = await PortfolioCommentService.delete({
      user: req.user,
      id_portfolio_comment: req.params.id_portfolio_comment,
    });
    return sendServiceResult(res, result);
  }
}

module.exports = PortfolioCommentController;
