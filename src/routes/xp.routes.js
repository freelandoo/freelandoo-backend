const { Router } = require("express");
const XpController = require("../controllers/XpController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.get("/:id/xp-summary", asyncHandler(XpController.getXpSummary));
router.get("/:id/xp-events", asyncHandler(XpController.getXpEvents));
router.get("/:id/xp-feed", asyncHandler(XpController.getXpFeed));

module.exports = router;
