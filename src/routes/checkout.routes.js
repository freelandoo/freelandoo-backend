const express = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const CheckoutController = require("../controllers/CheckoutController");
const asyncHandler = require("../utils/asyncHandler");
const rateLimit = require("../middlewares/rateLimit");

const router = express.Router();

router.post(
  "/",
  authMiddleware,
  rateLimit.checkout,
  asyncHandler(CheckoutController.createCheckout)
);

router.get(
  "/:id_checkout",
  authMiddleware,
  asyncHandler(CheckoutController.getCheckoutById)
);

router.post(
  "/:id_checkout/apply-coupon",
  authMiddleware,
  rateLimit.checkout,
  asyncHandler(CheckoutController.applyCoupon)
);

router.delete(
  "/:id_checkout/coupon",
  authMiddleware,
  asyncHandler(CheckoutController.removeCoupon)
);

router.post(
  "/:id_checkout/confirm",
  authMiddleware,
  rateLimit.checkout,
  asyncHandler(CheckoutController.confirmCheckout)
);

router.patch(
  "/:id_checkout/cancel",
  authMiddleware,
  asyncHandler(CheckoutController.cancelCheckout)
);

module.exports = router;
