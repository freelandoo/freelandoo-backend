const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const uploadAvatar = require("../middlewares/uploadAvatar");
const asyncHandler = require("../utils/asyncHandler");
const ProtectionController = require("../controllers/ProtectionController");

// Montado em /me. Provas de fulfillment + confirmação do cliente + status.
const router = Router();

// Lojista confirma a postagem (foto + rastreio ME já existente).
router.post(
  "/orders/:id/shipment-proof",
  authMiddleware,
  uploadAvatar.single("photo"),
  asyncHandler(ProtectionController.shipmentProof)
);

// Prestador anexa prova de chegada/início e de conclusão.
router.post(
  "/bookings/:id/arrival-proof",
  authMiddleware,
  uploadAvatar.single("photo"),
  asyncHandler(ProtectionController.bookingArrivalProof)
);
router.post(
  "/bookings/:id/completion-proof",
  authMiddleware,
  uploadAvatar.single("photo"),
  asyncHandler(ProtectionController.bookingCompletionProof)
);

// Cliente confirma a chegada do prestador (inicia a janela junto da prova).
router.post(
  "/bookings/:id/confirm",
  authMiddleware,
  asyncHandler(ProtectionController.confirmBookingArrival)
);

// Status da proteção (caso + provas) — comprador/lojista.
router.get(
  "/orders/:id/protection",
  authMiddleware,
  asyncHandler(ProtectionController.orderProtectionStatus)
);
router.get(
  "/bookings/:id/protection",
  authMiddleware,
  asyncHandler(ProtectionController.bookingProtectionStatus)
);

module.exports = router;
