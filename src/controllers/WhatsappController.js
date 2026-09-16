// src/controllers/WhatsappController.js
// Camada fina do WhatsApp do usuário (mig 223). Todos os guards — flag, ENV,
// dono da conversa, estado da sessão — moram no WhatsappService.

const WhatsappService = require("../services/WhatsappService");
const { sendServiceResult } = require("../utils/sendServiceResult");
class WhatsappController {
  static async status(req, res) {
    const result = await WhatsappService.status(req.user.id_user);
    return sendServiceResult(res, result);
  }


  static async disconnect(req, res) {
    const result = await WhatsappService.disconnect(req.user.id_user);
    return sendServiceResult(res, result);
  }

  /* ────────────── W3 — cadastro de número (Cloud API) ─────────────────── */

  static async cloudAddNumber(req, res) {
    const result = await WhatsappService.cloudAddNumber(req.user.id_user, req.body || {});
    return sendServiceResult(res, result);
  }

  static async cloudVerifyCode(req, res) {
    const result = await WhatsappService.cloudVerifyCode(
      req.user.id_user,
      (req.body || {}).code
    );
    return sendServiceResult(res, result);
  }

  static async cloudResendCode(req, res) {
    const result = await WhatsappService.cloudResendCode(
      req.user.id_user,
      (req.body || {}).method
    );
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
   * Meta na hora. `Cache-Control: private` porque isto é conversa de
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
}

module.exports = WhatsappController;
