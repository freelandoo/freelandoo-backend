// src/controllers/WhatsappController.js
// Camada fina do WhatsApp do usuário (mig 223). Todos os guards — flag, ENV,
// dono da conversa, estado da sessão — moram no WhatsappService.

const WhatsappService = require("../services/WhatsappService");
const WhatsappIngestService = require("../services/WhatsappIngestService");
const { sendServiceResult } = require("../utils/sendServiceResult");
const { createLogger } = require("../utils/logger");

const log = createLogger("WhatsappController");

class WhatsappController {
  static async status(req, res) {
    const result = await WhatsappService.status(req.user.id_user);
    return sendServiceResult(res, result);
  }

  static async qrcode(req, res) {
    const result = await WhatsappService.qrcode(req.user.id_user);
    return sendServiceResult(res, result);
  }

  static async disconnect(req, res) {
    const result = await WhatsappService.disconnect(req.user.id_user);
    return sendServiceResult(res, result);
  }

  static async listConversations(req, res) {
    const result = await WhatsappService.listConversations(req.user.id_user, req.query || {});
    return sendServiceResult(res, result);
  }

  static async listMessages(req, res) {
    const result = await WhatsappService.listMessages(
      req.user.id_user,
      req.params.id_conversation,
      req.query || {}
    );
    return sendServiceResult(res, result);
  }

  static async sendText(req, res) {
    const result = await WhatsappService.sendText(
      req.user.id_user,
      req.params.id_conversation,
      (req.body || {}).text
    );
    return sendServiceResult(res, result, 201);
  }

  /**
   * A única rota que não devolve JSON: são os bytes da mídia, buscados na
   * Evolution na hora. `Cache-Control: private` porque isto é conversa de
   * terceiro — nenhum proxy compartilhado pode guardar cópia.
   */
  static async media(req, res) {
    const result = await WhatsappService.media(req.user.id_user, req.params.id_message);
    if (!result || result.error) return sendServiceResult(res, result);

    const { bytes, mimetype, fileName } = result.file;
    res.setHeader("Content-Type", mimetype);
    res.setHeader("Content-Length", bytes.length);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${String(fileName).replace(/[^\w.\- ]/g, "_")}"`
    );
    return res.status(200).send(bytes);
  }

  /**
   * Webhook da Evolution. SÓ GRAVA — nunca responde a ninguém.
   *
   * Mesmo contrato de segurança do webhook do Stripe: em produção sem secret
   * configurado a rota se RECUSA a funcionar (503) em vez de aceitar qualquer
   * corpo que chegue. Sem isso, qualquer um na internet escreveria dentro da
   * caixa de entrada de um usuário.
   *
   * ⚠️ Responde 200 quase sempre, inclusive para o que ignora: a Evolution
   * reentrega o que falha, e devolver erro para um payload que nunca vai ser
   * aceito criaria uma fila de reentrega infinita.
   */
  static async webhook(req, res) {
    const expected = String(process.env.WHATSAPP_WEBHOOK_SECRET || "").trim();
    if (process.env.NODE_ENV === "production" && !expected) {
      return res.status(503).json({ error: "webhook secret não configurado" });
    }
    if (expected && req.headers["x-webhook-secret"] !== expected) {
      return res.status(401).json({ error: "não autorizado" });
    }

    const event = req.body;
    if (!event || typeof event !== "object") {
      return res.status(200).json({ received: true, ignored: "corpo inválido" });
    }

    try {
      const r = await WhatsappIngestService.process(event);
      return res.status(200).json({ received: true, ...r });
    } catch (e) {
      // 500 aqui é deliberado: erro real (banco fora) merece a reentrega da
      // Evolution, e o UNIQUE de `wa_message_id` torna a repetição inofensiva.
      log.error("webhook.failed", { ...WhatsappIngestService.logSummary(event), message: e && e.message });
      return res.status(500).json({ received: true, error: "falha ao processar" });
    }
  }
}

module.exports = WhatsappController;
