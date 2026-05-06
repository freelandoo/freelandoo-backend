const { Router } = require("express");
const PortfolioFeedController = require("../controllers/PortfolioFeedController");
const PortfolioEventController = require("../controllers/PortfolioEventController");
const optionalAuthMiddleware = require("../middlewares/optionalAuthMiddleware");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.get(
  "/portfolio",
  optionalAuthMiddleware,
  asyncHandler(PortfolioFeedController.list)
);

router.post(
  "/events",
  optionalAuthMiddleware,
  asyncHandler(PortfolioEventController.record)
);

module.exports = router;
