const { Router } = require("express");
const PublicPricingController = require("../controllers/PublicPricingController");
const PublicCouponController = require("../controllers/PublicCouponController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();
router.get("/pricing", asyncHandler(PublicPricingController.get));
router.get("/coupon/:code", asyncHandler(PublicCouponController.get));
module.exports = router;
