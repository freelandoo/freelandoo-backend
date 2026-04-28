const { Router } = require("express");
const PortfolioController = require("../controllers/PortfolioController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.get(
  "/portfolio-item/:id_portfolio_item",
  asyncHandler(PortfolioController.getPublicItem)
);

module.exports = router;
