const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const BookingController = require("../controllers/BookingController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

// ─── Owner: regras semanais ────────────────────────────────────────
router.get(
  "/:id_profile/availability",
  authMiddleware,
  asyncHandler(BookingController.getWeeklyRules)
);
router.post(
  "/:id_profile/availability",
  authMiddleware,
  asyncHandler(BookingController.saveWeeklyRules)
);

// ─── Owner: exceções por data ──────────────────────────────────────
router.get(
  "/:id_profile/availability-overrides",
  authMiddleware,
  asyncHandler(BookingController.getOverrides)
);
router.post(
  "/:id_profile/availability-overrides",
  authMiddleware,
  asyncHandler(BookingController.saveOverride)
);
router.delete(
  "/:id_profile/availability-overrides/:overrideId",
  authMiddleware,
  asyncHandler(BookingController.deleteOverride)
);

// ─── Owner: configurações de sinal ─────────────────────────────────
router.get(
  "/:id_profile/booking-settings",
  authMiddleware,
  asyncHandler(BookingController.getBookingSettings)
);
router.post(
  "/:id_profile/booking-settings",
  authMiddleware,
  asyncHandler(BookingController.saveBookingSettings)
);

// ─── Owner: agendamentos ───────────────────────────────────────────
router.get(
  "/:id_profile/bookings",
  authMiddleware,
  asyncHandler(BookingController.listProfileBookings)
);

module.exports = router;
