const { Router } = require("express");
const PublicPricingController = require("../controllers/PublicPricingController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();
router.get("/pricing", asyncHandler(PublicPricingController.get));
module.exports = router;
