const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const BookingController = require("../controllers/BookingController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

// ─── Público: slots disponíveis ────────────────────────────────────
router.get(
  "/:id_profile/available-slots",
  asyncHandler(BookingController.getAvailableSlots)
);

// ─── Público: dados completos da semana ─────────────────────────────
router.get(
  "/:id_profile/calendar/week",
  asyncHandler(BookingController.getWeekData)
);

// ─── Público: criar booking ────────────────────────────────────────
router.post(
  "/:id_profile/bookings",
  asyncHandler(BookingController.createPublicBooking)
);

// ─── Owner: todos os agendamentos do usuário ───────────────────────
router.get(
  "/my-bookings",
  authMiddleware,
  asyncHandler(BookingController.listOwnerBookings)
);

// ─── Owner: atualizar status ───────────────────────────────────────
router.patch(
  "/bookings/:bookingId/status",
  authMiddleware,
  asyncHandler(BookingController.updateBookingStatus)
);

module.exports = router;
