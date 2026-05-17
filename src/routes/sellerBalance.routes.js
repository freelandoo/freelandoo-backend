const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const SellerBalanceController = require("../controllers/SellerBalanceController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.get("/me/seller-balance", authMiddleware, asyncHandler(SellerBalanceController.listMine));

router.get(
  "/admin/seller-payouts",
  [authMiddleware, roleMiddleware("Administrator")],
  asyncHandler(SellerBalanceController.listAdmin)
);

router.post(
  "/admin/seller-payouts/:id_balance/mark-paid",
  [authMiddleware, roleMiddleware("Administrator")],
  asyncHandler(SellerBalanceController.markPaidOut)
);

module.exports = router;
