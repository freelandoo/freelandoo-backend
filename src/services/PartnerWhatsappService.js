// src/services/PartnerWhatsappService.js
// O WhatsApp oficial de uma academia, operado pelo SISTEMA dela (mig 307 — o
// Coliseu) pela API de parceiro. A Freelandoo é a ponte: o que chega no número
// é repassado (WhatsappForwardDispatcher), e o que o sistema manda sai daqui.
//
// ⚠️ É ATENDIMENTO, NÃO DISPARO — a regra do portfólio inteiro (ver o topo do
// WhatsappCloudIngestService): só texto livre, só dentro da janela de 24h, só
// para quem já escreveu. Sem template e sem iniciar conversa. A janela é a da
// MESMA coluna que o WhatsappService confere.
//
// Respostas no formato do contrato da API de parceiro: { status, body } com
// `erro` de código estável (docs/API_PARTNER.md).
const crypto = require("crypto");
const pool = require("../databases");
const WhatsappStorage = require("../storages/WhatsappStorage");
const WhatsappForwardStorage = require("../storages/WhatsappForwardStorage");
const AcademyStorage = require("../storages/AcademyStorage");
const whatsappProvider = require("../integrations/whatsappProvider");
const secretBox = require("../utils/secretBox");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("partner-whatsapp");

const MAX_TEXT = 4096;

function fail(status, erro, extra = {}) {
  return { status, body: { erro, ...extra } };
}

function digits(s) {
  return String(s || "").replace(/\D/g, "");
}

function providerError(e) {
  if (e && e.name === "CloudApiError") return fail(e.statusCode || 502, "whatsapp_erro", { detalhe: e.message });
  log.error("partner.whatsapp.unexpected", { message: e && e.message });
  return fail(502, "whatsapp_erro", { detalhe: "Falha ao falar com o WhatsApp." });
}

class PartnerWhatsappService {
  // ─── GET /partner/v1/whatsapp ──────────────────────────────────────────────
  static async status(academy) {
    const i = await WhatsappForwardStorage.getAcademyInstance(pool, academy.id_academy);
    return {
      status: 200,
      body: {
        conectado: !!i && i.status === "connected",
        numero: i ? i.connected_number || null : null,
        qualidade: i ? i.quality_rating || null : null,
        webhook_configurado: !!academy.whatsapp_webhook_url,
      },
    };
  }

  // ─── PUT /partner/v1/whatsapp/webhook ──────────────────────────────────────
  // Gera um segredo novo a cada chamada e o devolve UMA vez (guardado selado).
  static async setWebhook(academy, body) {
    let url;
    try {
      url = new URL(String((body && body.url) || ""));
    } catch {
      return fail(400, "url_invalida");
    }
    if (url.protocol !== "https:") return fail(400, "url_invalida", { detalhe: "Use https." });
    const secret = crypto.randomBytes(32).toString("hex");
    await WhatsappForwardStorage.setWebhook(pool, academy.id_academy, {
      url: url.toString(),
      secret_sealed: secretBox.seal(secret),
    });
    return { status: 200, body: { url: url.toString(), segredo: secret } };
  }

  // ─── POST /partner/v1/whatsapp/mensagens ───────────────────────────────────
  static async sendText(academy, body) {
    return runWithLogs(log, "sendText", () => ({ id_academy: academy.id_academy }), async () => {
      const texto = String((body && body.texto) || "").trim();
      const telefone = digits(body && body.telefone);
      if (!texto) return fail(400, "texto_vazio");
      if (texto.length > MAX_TEXT) return fail(400, "texto_longo");
      if (!telefone) return fail(400, "telefone_invalido");

      const instance = await WhatsappForwardStorage.getAcademyInstance(pool, academy.id_academy);
      if (!instance) return fail(409, "sem_numero");
      if (instance.status !== "connected") return fail(409, "numero_desconectado");

      // A JANELA: só responde a quem escreveu, dentro de 24h da última
      // mensagem dele. Sem conversa = a pessoa nunca escreveu neste número.
      const conversation = await WhatsappForwardStorage.getConversationByPhone(pool, instance.id_instance, telefone);
      const until = conversation && conversation.service_window_expires_at
        ? new Date(conversation.service_window_expires_at)
        : null;
      if (!until || until.getTime() <= Date.now()) {
        return fail(409, "janela_fechada", {
          detalhe: "A janela de 24h desta conversa fechou. Só dá para responder depois que a pessoa escrever de novo.",
        });
      }

      const provider = whatsappProvider.forInstance(instance);
      if (!provider || !provider.isAvailable()) return fail(503, "whatsapp_indisponivel");

      let waMessageId;
      try {
        waMessageId = await provider.sendText(instance, telefone, texto);
      } catch (e) {
        return providerError(e);
      }

      const sentAt = new Date();
      await WhatsappStorage.insertMessage(pool, {
        id_conversation: conversation.id_conversation,
        wa_message_id: waMessageId,
        direction: "out",
        sender_label: null,
        body: texto,
        media_type: "text",
        sent_at: sentAt,
      });
      await WhatsappStorage.touchConversation(pool, conversation.id_conversation, {
        preview: texto,
        sent_at: sentAt,
        inc_unread: false,
      });
      return { status: 200, body: { wa_message_id: waMessageId, janela_ate: until.toISOString() } };
    });
  }

  // ─── GET /partner/v1/whatsapp/midia/:media_id ──────────────────────────────
  // Só mídia que chegou no número DESTA academia.
  static async media(academy, media_id) {
    const id = String(media_id || "");
    if (!id || !(await WhatsappForwardStorage.mediaBelongsToAcademy(pool, academy.id_academy, id))) {
      return { status: 404, body: { erro: "nao_encontrado" } };
    }
    const provider = whatsappProvider.get("cloud");
    if (!provider || !provider.isAvailable()) return fail(503, "whatsapp_indisponivel");
    try {
      const file = await provider.fetchMediaById(id);
      return { status: 200, file };
    } catch (e) {
      return providerError(e);
    }
  }

  // ─── Dono da academia: usar o MEU número oficial pelo sistema da academia ──
  static async ownerStatus(id_user, id_academy) {
    const academy = await AcademyStorage.getById(pool, id_academy);
    if (!academy || academy.id_owner_user !== id_user) return { error: "Sem permissão", statusCode: 403 };
    const mine = await WhatsappStorage.getInstanceByUser(pool, id_user);
    const linked = await WhatsappForwardStorage.getAcademyInstance(pool, id_academy);
    return {
      meu_numero: mine && mine.provider === "cloud" && mine.status === "connected" ? mine.connected_number : null,
      ativo: !!linked && !!mine && linked.id_instance === mine.id_instance,
      webhook_configurado: !!academy.whatsapp_webhook_url,
    };
  }

  static async ownerSetForward(id_user, id_academy, ativo) {
    return runWithLogs(log, "ownerSetForward", () => ({ id_user, id_academy, ativo }), async () => {
      const academy = await AcademyStorage.getById(pool, id_academy);
      if (!academy || academy.id_owner_user !== id_user) return { error: "Sem permissão", statusCode: 403 };
      const mine = await WhatsappStorage.getInstanceByUser(pool, id_user);
      if (!mine || mine.provider !== "cloud" || mine.status !== "connected") {
        return { error: "Conecte primeiro o seu WhatsApp oficial em Mensagens → WhatsApp.", statusCode: 409 };
      }
      await WhatsappForwardStorage.setForward(pool, mine.id_instance, ativo ? id_academy : null);
      return this.ownerStatus(id_user, id_academy);
    });
  }
}

module.exports = PartnerWhatsappService;
