const { Router } = require("express");
const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const StripeController = require("../controllers/StripeController");
const WhatsappController = require("../controllers/WhatsappController");
const AsaasController = require("../controllers/AsaasController");

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

/**
 * Asaas → cobranças (mig 231/236).
 *
 * ⚠️ `express.json()` explícito, e NÃO `express.raw`: diferente do Stripe, o
 * Asaas não assina o corpo — não há HMAC a conferir sobre os bytes crus. A
 * autenticação é o header `asaas-access-token`, checado no controller.
 *
 * Montado aqui, junto dos outros webhooks, para herdar as duas propriedades
 * que esta posição no app.js garante: ANTES do express.json() global e ANTES
 * do rate limit — senão um retry legítimo do provedor levaria 429 e o
 * pagamento ficaria cobrado e sem entrega.
 */
router.post(
  "/asaas",
  express.json({ limit: "1mb" }),
  asyncHandler(AsaasController.handleWebhook)
);

module.exports = router;
