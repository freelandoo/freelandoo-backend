const { Router } = require("express");
const PaymentController = require("../controllers/PaymentController");
const authMiddleware = require("../middlewares/authMiddleware");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.post(
  "/activation",
  authMiddleware,
  asyncHandler(PaymentController.createActivationPayment)
);

router.get(
  "/history",
  authMiddleware,
  asyncHandler(PaymentController.listMyHistory)
);

router.get(
  "/:id",
  authMiddleware,
  asyncHandler(PaymentController.getMyPaymentById)
);

router.post(
  "/webhooks/mercadopago",
  asyncHandler(PaymentController.handleMercadoPagoWebhook)
);

module.exports = router;
