const { Router } = require("express");
const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const StripeController = require("../controllers/StripeController");
const WhatsappController = require("../controllers/WhatsappController");
const WhatsappCloudWebhookController = require("../controllers/WhatsappCloudWebhookController");
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
 * Meta WhatsApp Cloud API → o caminho OFICIAL (mig 240, W2).
 *
 * ⚠️ CAMINHO PRÓPRIO, e não `/whatsapp`: aquele é da Evolution e continua de
 * pé durante toda a coexistência. Um endereço só para os dois faria cada POST
 * ser testado contra dois formatos e dois esquemas de autenticação — e o
 * provedor errado ganharia o empate em silêncio.
 *
 * ⚠️ `express.raw()`, como o Stripe e ao contrário dos outros três: aqui a
 * autenticação é HMAC-SHA256 sobre os BYTES CRUS do corpo
 * (`X-Hub-Signature-256`). `express.json()` consumiria o stream e a assinatura
 * ficaria inconferível — o sintoma é 401 em tudo, e a "correção" tentadora é
 * desligar a checagem, o que devolve uma rota pública que aceita qualquer
 * corpo da internet.
 *
 * O GET é o handshake da inscrição: a Meta chama com `hub.challenge` e espera
 * ele de volta em texto puro. Sem essa rota a inscrição nem é aceita.
 */
router.get("/whatsapp-cloud", asyncHandler(WhatsappCloudWebhookController.verify));

router.post(
  "/whatsapp-cloud",
  express.raw({ type: "application/json", limit: "2mb" }),
  asyncHandler(WhatsappCloudWebhookController.receive)
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
