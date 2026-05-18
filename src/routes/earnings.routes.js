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

module.exports = router;
