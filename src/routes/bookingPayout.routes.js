const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const BookingPayoutController = require("../controllers/BookingPayoutController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.get("/me/booking-payouts", authMiddleware, asyncHandler(BookingPayoutController.listMine));

router.get(
  "/admin/booking-payouts",
  [authMiddleware, roleMiddleware("Administrator")],
  asyncHandler(BookingPayoutController.listAdmin)
);

router.post(
  "/admin/booking-payouts/:id_payout/mark-paid",
  [authMiddleware, roleMiddleware("Administrator")],
  asyncHandler(BookingPayoutController.markPaidOut)
);

module.exports = router;
