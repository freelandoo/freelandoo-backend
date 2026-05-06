const pool = require("../databases");
const PortfolioEventService = require("../services/portfolioFeed/PortfolioEventService");

class PortfolioEventController {
  static async record(req, res) {
    const { post_id, event_type, session_id, filters, metadata } = req.body || {};

    const result = await PortfolioEventService.record({
      db: pool,
      payload: { post_id, event_type, session_id, filters, metadata },
      viewer: req.user || null,
    });

    return res.status(result.status).json(result.body);
  }
}

module.exports = PortfolioEventController;
