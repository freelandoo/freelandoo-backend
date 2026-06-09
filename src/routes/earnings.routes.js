const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const EarningsController = require("../controllers/EarningsController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.get("/me/earnings", authMiddleware, asyncHandler(EarningsController.listMine));
router.get(
  "/me/earnings/coupon-sales",
  authMiddleware,
  asyncHandler(EarningsController.listCouponSales)
);
router.get("/me/earnings/series", authMiddleware, asyncHandler(EarningsController.series));

module.exports = router;
