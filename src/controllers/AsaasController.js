const crypto = require("crypto");
const AsaasWebhookService = require("../services/AsaasWebhookService");
const asaas = require("../integrations/payments/asaasClient");
const { createLogger } = require("../utils/logger");

const log = createLogger("AsaasController");

/**
 * Comparação em tempo constante.
 *
 * ⚠️ `a === b` vaza o tamanho do prefixo correto pelo TEMPO da comparação, e
 * este token é a única coisa que separa o nosso webhook de qualquer um que
 * saiba a URL — e o webhook ENTREGA PRODUTO. Vale o cuidado.
 */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a || ""), "utf8");
  const bufB = Buffer.from(String(b || ""), "utf8");
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

class AsaasController {
  /**
   * POST /webhooks/asaas
   *
   * ⚠️ O Asaas NÃO assina o corpo como o Stripe faz — não há HMAC para
   * conferir. A autenticação é o `authToken` que nós configuramos ao criar o
   * webhook, e que ele devolve no header `asaas-access-token`. Por isso o corpo
   * pode ser lido como JSON normal (não precisa de `express.raw`).
   *
   * ⚠️ SEM O TOKEN CONFIGURADO, A ROTA SE RECUSA A FUNCIONAR em vez de aceitar
   * qualquer corpo da internet. Um endpoint aberto que credita Polén e ativa
   * perfil é um caixa aberto: bastaria alguém postar um JSON com um id de
   * intenção para levar o produto sem pagar.
   */
  static async handleWebhook(req, res) {
    const cfg = asaas.config();
    const expected = (cfg && cfg.webhookToken) || String(process.env.ASAAS_WEBHOOK_TOKEN || "").trim();

    if (!expected) {
      log.error("webhook.token_not_configured");
      return res.status(503).json({ error: "Webhook do Asaas não configurado" });
    }

    const received = req.headers["asaas-access-token"];
    if (!safeEqual(received, expected)) {
      log.warn("webhook.token_invalid");
      return res.status(401).json({ error: "Token inválido" });
    }

    const event = req.body || {};

    try {
      const result = await AsaasWebhookService.processEvent(event);
      // ⚠️ 2xx SEMPRE que o evento foi tratado — inclusive quando ignorado. O
      // Asaas re-enfileira o que não recebe 2xx, e uma cobrança que não é nossa
      // ficaria sendo re-entregue para sempre, travando a fila dos eventos que
      // importam (a entrega dele é sequencial por padrão).
      return res.json({ received: true, ...result });
    } catch (err) {
      log.error("webhook.process_fail", {
        event_id: event.id || null,
        type: event.event || null,
        message: err && err.message,
      });
      // 500 de propósito: falha REAL de processamento precisa ser re-tentada,
      // senão o pagamento fica cobrado e sem entrega.
      return res.status(500).json({ error: "Falha ao processar evento" });
    }
  }
}

module.exports = AsaasController;
