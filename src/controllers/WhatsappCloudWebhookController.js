// src/controllers/WhatsappCloudWebhookController.js
// Webhook da Meta Cloud API. SÓ GRAVA — nunca responde a ninguém.
//
// Camada fina: autentica (GET de verificação e HMAC no POST), parseia o corpo
// cru e entrega ao `WhatsappCloudIngestService`. Toda regra de conversa mora lá.
//
// ─── POR QUE NÃO USA `cloud.config()` ───────────────────────────────────────
//
// Seria natural pegar as credenciais do adaptador, mas `config()` devolve NULL
// enquanto faltar qualquer uma das quatro ENVs — inclusive `META_WABA_ID`, que
// é do lado de ENVIAR. O webhook precisa estar de pé ANTES de existir WABA
// configurado: é ele que a Meta chama para aceitar a inscrição, e a inscrição
// vem antes do primeiro número. Acoplar os dois faria o handshake falhar com
// 503 e a mensagem na tela da Meta seria só "não foi possível validar a URL".

const WhatsappCloudIngestService = require("../services/WhatsappCloudIngestService");
const { isValidSignature, readVerification } = require("../utils/whatsappCloudSignature");
const { createLogger } = require("../utils/logger");

const log = createLogger("WhatsappCloudWebhook");

class WhatsappCloudWebhookController {
  /**
   * GET — handshake da inscrição.
   *
   * ⚠️ A resposta é o `hub.challenge` em TEXTO PURO, com 200. Devolver JSON
   * (ou o challenge dentro de um objeto) faz a Meta recusar a URL sem dizer o
   * motivo — o painel só mostra "não foi possível validar".
   */
  static async verify(req, res) {
    const verifyToken = String(process.env.META_WEBHOOK_VERIFY_TOKEN || "").trim();
    const result = readVerification(req.query || {}, verifyToken);

    if (!result.ok) {
      log.warn("cloud.verify.rejected", { reason: result.reason });
      return res.status(403).type("text/plain").send("forbidden");
    }

    log.info("cloud.verify.ok", {});
    return res.status(200).type("text/plain").send(result.challenge);
  }

  /**
   * POST — o que chega.
   *
   * `req.body` é um Buffer: a rota usa `express.raw()` porque o HMAC é sobre os
   * BYTES CRUS. Ler o JSON antes torna a assinatura inconferível, e o sintoma
   * seria uma rota pública aceitando qualquer corpo da internet.
   *
   * ⚠️ Responde 200 quase sempre, inclusive para o que ignora: a Meta reentrega
   * o que falha, e devolver erro para um payload que nunca vai ser aceito
   * criaria uma fila de reentrega que não esvazia.
   */
  static async receive(req, res) {
    const appSecret = String(process.env.META_APP_SECRET || "").trim();

    // Mesmo contrato do webhook do Stripe: em produção sem segredo a rota se
    // RECUSA a funcionar, em vez de aceitar qualquer corpo que chegue.
    if (process.env.NODE_ENV === "production" && !appSecret) {
      log.error("cloud.no_app_secret", {});
      return res.status(503).json({ error: "META_APP_SECRET não configurado" });
    }

    if (appSecret) {
      const signature = req.headers["x-hub-signature-256"];
      if (!isValidSignature(req.body, signature, appSecret)) {
        log.warn("cloud.bad_signature", { present: !!signature });
        return res.status(401).json({ error: "assinatura inválida" });
      }
    }

    let body = null;
    try {
      const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : req.body;
      body = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      // Corpo que não é JSON nunca vai virar JSON numa reentrega.
      return res.status(200).json({ received: true, ignored: "corpo inválido" });
    }

    if (!body || typeof body !== "object") {
      return res.status(200).json({ received: true, ignored: "corpo inválido" });
    }

    try {
      const r = await WhatsappCloudIngestService.process(body);
      return res.status(200).json({ received: true, ...r });
    } catch (e) {
      // 500 aqui é deliberado: erro real (banco fora) merece a reentrega da
      // Meta, e o UNIQUE de `wa_message_id` torna a repetição inofensiva.
      log.error("cloud.webhook.failed", {
        ...WhatsappCloudIngestService.logSummary(body),
        message: e && e.message,
      });
      return res.status(500).json({ received: true, error: "falha ao processar" });
    }
  }
}

module.exports = WhatsappCloudWebhookController;
