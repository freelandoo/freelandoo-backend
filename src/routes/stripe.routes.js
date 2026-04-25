const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const asyncHandler = require("../utils/asyncHandler");
const StripeController = require("../controllers/StripeController");

const router = Router();

router.post(
  "/subscription/checkout",
  authMiddleware,
  asyncHandler(StripeController.createSubscriptionCheckout)
);

router.get(
  "/subscription/me",
  authMiddleware,
  asyncHandler(StripeController.getMySubscriptions)
);

module.exports = router;
