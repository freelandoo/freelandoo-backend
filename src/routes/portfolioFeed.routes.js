const { Router } = require("express");
const PortfolioFeedController = require("../controllers/PortfolioFeedController");
const optionalAuthMiddleware = require("../middlewares/optionalAuthMiddleware");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.get(
  "/portfolio",
  optionalAuthMiddleware,
  asyncHandler(PortfolioFeedController.list)
);

module.exports = router;
