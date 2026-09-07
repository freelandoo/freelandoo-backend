const { Router } = require("express");
const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const StripeController = require("../controllers/StripeController");
const WhatsappController = require("../controllers/WhatsappController");

const router = Router();

router.post(
  "/stripe",
  express.raw({ type: "application/json" }),
  asyncHandler(StripeController.handleWebhook)
);

/**
 * Evolution API → WhatsApp do usuário (mig 223).
 *
 * `express.json()` explícito porque todo o /webhooks é montado ANTES do
 * express.json() global (o Stripe precisa do corpo cru para conferir a
 * assinatura). Aqui a autenticação é o header `x-webhook-secret`, conferido no
 * controller, então o corpo pode ser lido como JSON normalmente.
 *
 * 2mb: o webhook traz texto e metadado, nunca o binário da mídia
 * (`base64: false` na configuração da instância).
 */
router.post(
  "/whatsapp",
  express.json({ limit: "2mb" }),
  asyncHandler(WhatsappController.webhook)
);

module.exports = router;
