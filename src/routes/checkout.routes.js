const express = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const CheckoutController = require("../controllers/CheckoutController");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

router.post(
  "/",
  authMiddleware,
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
  asyncHandler(CheckoutController.confirmCheckout)
);

router.patch(
  "/:id_checkout/cancel",
  authMiddleware,
  asyncHandler(CheckoutController.cancelCheckout)
);

module.exports = router;
