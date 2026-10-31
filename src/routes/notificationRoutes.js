const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const NotificationController = require("../controllers/NotificationController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.get("/", authMiddleware, asyncHandler(NotificationController.list));

router.get(
  "/unread-count",
  authMiddleware,
  asyncHandler(NotificationController.unreadCount)
);

// Agendamentos ainda não vistos (modal "Novo agendamento", 2026-10-31).
router.get(
  "/bookings-pending",
  authMiddleware,
  asyncHandler(NotificationController.pendingBookings)
);

router.post(
  "/mark-all-read",
  authMiddleware,
  asyncHandler(NotificationController.markAllRead)
);

router.post(
  "/:id_notification/mark-read",
  authMiddleware,
  asyncHandler(NotificationController.markOneRead)
);

module.exports = router;
