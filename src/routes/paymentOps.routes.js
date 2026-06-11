const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const PaymentOpsController = require("../controllers/PaymentOpsController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();
const adminGuard = [authMiddleware, roleMiddleware("Administrator")];

// Painel de saúde de pagamentos (projeto PayDebug).
router.get(
  "/admin/payments/webhook-events",
  adminGuard,
  asyncHandler(PaymentOpsController.listWebhookEvents)
);
router.post(
  "/admin/payments/webhook-events/:event_id/reprocess",
  adminGuard,
  asyncHandler(PaymentOpsController.reprocessWebhookEvent)
);
router.get(
  "/admin/payments/stuck",
  adminGuard,
  asyncHandler(PaymentOpsController.listStuck)
);
router.post(
  "/admin/payments/reconcile",
  adminGuard,
  asyncHandler(PaymentOpsController.reconcileNow)
);

module.exports = router;
