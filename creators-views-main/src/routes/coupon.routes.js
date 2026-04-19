const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const CouponController = require("../controllers/CouponController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.post("/", authMiddleware, asyncHandler(CouponController.create));

router.get("/", authMiddleware, asyncHandler(CouponController.getUserCoupon));

router.post("/validate", asyncHandler(CouponController.validate));

module.exports = router;
