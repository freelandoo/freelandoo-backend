const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const AffiliateController = require("../controllers/AffiliateController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.get("/", authMiddleware, asyncHandler(AffiliateController.getMe));
router.put("/payout-info", authMiddleware, asyncHandler(AffiliateController.updateMyPayoutInfo));
router.get("/conversions", authMiddleware, asyncHandler(AffiliateController.listMyConversions));

module.exports = router;
