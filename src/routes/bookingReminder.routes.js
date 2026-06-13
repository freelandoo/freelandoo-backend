const { Router } = require("express");
const BookingReminderController = require("../controllers/BookingReminderController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

// Confirmação de presença pelo cliente (link do e-mail de lembrete). PÚBLICO —
// o próprio token UUID é a credencial. Sem authMiddleware.
router.get("/bookings/confirm/:token", asyncHandler(BookingReminderController.getConfirmInfo));
router.post("/bookings/confirm/:token", asyncHandler(BookingReminderController.submitConfirm));

module.exports = router;
