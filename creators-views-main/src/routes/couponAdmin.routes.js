const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const CouponAdminController = require("../controllers/CouponAdminController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();
const admin = [authMiddleware, roleMiddleware("Administrator")];

// Regra geral de desconto
router.get("/discount-settings", ...admin, asyncHandler(CouponAdminController.getDiscountSettings));
router.get(
  "/discount-settings/history",
  ...admin,
  asyncHandler(CouponAdminController.listDiscountSettings)
);
router.post(
  "/discount-settings",
  ...admin,
  asyncHandler(CouponAdminController.createDiscountSettings)
);

// Regra geral de comissão (reusa tb_affiliate_settings)
router.get(
  "/commission-settings",
  ...admin,
  asyncHandler(CouponAdminController.getCommissionSettings)
);
router.post(
  "/commission-settings",
  ...admin,
  asyncHandler(CouponAdminController.createCommissionSettings)
);

// Busca cupom específico
router.get("/search", ...admin, asyncHandler(CouponAdminController.searchCoupon));

// Override por cupom
router.put(
  "/:id_coupon/discount-override",
  ...admin,
  asyncHandler(CouponAdminController.upsertDiscountOverride)
);
router.delete(
  "/:id_coupon/discount-override",
  ...admin,
  asyncHandler(CouponAdminController.deleteDiscountOverride)
);
router.put(
  "/:id_coupon/commission-override",
  ...admin,
  asyncHandler(CouponAdminController.upsertCommissionOverride)
);
router.delete(
  "/:id_coupon/commission-override",
  ...admin,
  asyncHandler(CouponAdminController.deleteCommissionOverride)
);

module.exports = router;
