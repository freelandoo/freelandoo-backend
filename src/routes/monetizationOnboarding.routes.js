const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const asyncHandler = require("../utils/asyncHandler");
const MonetizationOnboardingController = require("../controllers/MonetizationOnboardingController");

const router = Router();

router.get("/status", authMiddleware, asyncHandler(MonetizationOnboardingController.status));
router.post("/select", authMiddleware, asyncHandler(MonetizationOnboardingController.select));
router.post("/dismiss", authMiddleware, asyncHandler(MonetizationOnboardingController.dismiss));

module.exports = router;
