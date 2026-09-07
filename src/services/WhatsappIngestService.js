// src/services/WhatsappIngestService.js
// Ingestão do webhook da Evolution (mig 223): o que CHEGA.
//
// ─── INVARIANTE DO SUBSISTEMA (copiado do Coliseu, e pela mesma razão) ──────
//
// Este módulo NÃO importa `integrations/evolution` — o único lugar que envia
// mensagem. Não existe caminho de código daqui até um `sendText`, e é isso, e
// não uma regra escrita, que garante que ninguém é respondido automaticamente
// pelo WhatsApp de um usuário da Freelandoo. Se um dia a ingestão precisar
// falar com a Evolution, é uma decisão a tomar de olhos abertos.
//
// ─── A ARMADILHA QUE O COPY DO COLISEU TRAZ ─────────────────────────────────
//
// Lá a ingestão chama `instanciaAtualRepo()` — "a instância", no singular,
// porque a academia tem UM WhatsApp. Aqui cada usuário tem o seu, e a pergunta
// "de quem é esta mensagem?" só tem uma resposta legítima: o campo `instance`
// do próprio evento, casado com `tb_whatsapp_instance.evolution_instance`.
// Instância desconhecida é IGNORADA — nunca atribuída a alguém.
//
// ─── POR QUE NUNCA LANÇA POR CONTEÚDO ───────────────────────────────────────
//
// A rota é pública e o corpo vem de fora. Payload torto vira `ignored`, e só
// erro real (banco fora) sobe — a Evolution reentrega nesse caso, e o índice
// UNIQUE do `wa_message_id` torna a repetição inofensiva.

const pool = require("../databases");
const WhatsappStorage = require("../storages/WhatsappStorage");
const realtime = require("../realtime/socket");
const { readMessage, messagesOfEvent, isConnectionOpen } = require("../utils/whatsappPayload");
const {
  isConversationJid,
  isGroupJid,
  phoneFromJid,
  formatPhone,
  redactPhone,
} = require("../utils/whatsappJid");
const { createLogger } = require("../utils/logger");

const log = createLogger("WhatsappIngestService");

class WhatsappIngestService {
  /**
   * `connection.update` — mantém o status em dia SEM polling.
   *
   * ⚠️ Só `close` derruba. A Evolution emite `connecting` também durante o
   * handshake e a reconexão; tratar tudo que não é `open` como desconectado
   * marcava a sessão como caída no meio de uma conversa saudável, e o status
   * ficava grudado assim — bug que o Coliseu pagou e está anotado lá.
   */
  static async _handleConnection(instance, data) {
    const open = isConnectionOpen(data.state);
    const state = String(data.state || "").toLowerCase();
    if (!open && state !== "close") return { type: "connection", connected: open };

    // `wuid` é o JID do número que pareou: é o que a tela mostra para a pessoa
    // conferir QUAL WhatsApp está ligado antes de responder por ele.
    const number = typeof data.wuid === "string" ? data.wuid.split("@")[0] : undefined;
    await WhatsappStorage.setInstanceStatus(
      pool,
      instance.evolution_instance,
      open ? "connected" : "disconnected",
      open ? number || undefined : null
    );

    realtime.emitToUser(instance.id_user, "whatsapp:status", {
      status: open ? "connected" : "disconnected",
      number: open ? formatPhone(number) : "",
    });
    return { type: "connection", connected: open };
  }

  static async _handleMessages(instance, data) {
    let saved = 0;
    let duplicated = 0;

    for (const raw of messagesOfEvent(data)) {
      const msg = readMessage(raw);
      if (!msg) continue;
      // Transmissão e status não são conversa: são publicação de mão única, e
      // apareceriam na lista como alguém esperando resposta.
      if (!isConversationJid(msg.remoteJid)) continue;

      const group = isGroupJid(msg.remoteJid);
      const conversation = await WhatsappStorage.ensureConversation(pool, {
        id_instance: instance.id_instance,
        remote_jid: msg.remoteJid,
        phone: phoneFromJid(msg.remoteJid),
        // Em grupo o `pushName` é de QUEM ESCREVEU, não do grupo: usá-lo como
        // título faria a conversa trocar de nome a cada mensagem.
        push_name: group ? "" : msg.pushName,
        is_group: group,
      });

      const saved_row = await WhatsappStorage.insertMessage(pool, {
        id_conversation: conversation.id_conversation,
        wa_message_id: msg.waMessageId,
        // `fromMe` = respondido pelo CELULAR do dono. Entra como saída para a
        // conversa aqui ser a conversa inteira, e não a metade que passou por nós.
        direction: msg.fromMe ? "out" : "in",
        sender_label: group ? this._senderLabel(msg) : null,
        body: msg.body,
        media_type: msg.mediaType,
        sent_at: msg.sentAt,
      });

      if (!saved_row) {
        duplicated++;
        continue;
      }
      saved++;

      await WhatsappStorage.touchConversation(pool, conversation.id_conversation, {
        preview: msg.body,
        sent_at: msg.sentAt,
        // O eco do que a própria pessoa mandou não pode acender "não lida"
        // contra ela mesma.
        inc_unread: !msg.fromMe,
      });

      // Push em vez de polling: a caixa se atualiza sozinha sem a Vercel pagar
      // uma requisição por visitante a cada poucos segundos (regra da economia).
      realtime.emitToUser(instance.id_user, "whatsapp:message", {
        id_conversation: conversation.id_conversation,
        message: saved_row,
        conversation: {
          id_conversation: conversation.id_conversation,
          remote_jid: conversation.remote_jid,
          phone: conversation.phone,
          push_name: conversation.push_name,
          is_group: conversation.is_group,
          last_message_preview: msg.body.slice(0, 300),
          last_message_at: msg.sentAt,
        },
      });
    }

    return { type: "messages", saved, duplicated };
  }

  /** Quem escreveu dentro do grupo. Sem nome e sem telefone, a bolha fica sem
   *  assinatura — melhor que inventar um autor. */
  static _senderLabel(msg) {
    return msg.pushName || formatPhone(phoneFromJid(msg.participant)) || null;
  }

  /** Ponto de entrada do webhook. */
  static async process(event) {
    const type = String((event && event.event) || "").toLowerCase();
    const instanceName = String((event && event.instance) || "").trim();
    if (!instanceName) return { type: "ignored", reason: "evento sem instância" };

    const instance = await WhatsappStorage.getInstanceByName(pool, instanceName);
    // Instância que não é nossa (ou que já foi removida do banco): ignorar é a
    // única resposta correta — atribuir a alguém seria entregar a conversa de
    // um desconhecido para um usuário qualquer.
    if (!instance) {
      log.warn("ingest.unknown_instance", { instance: instanceName, event: type });
      return { type: "ignored", reason: "instância desconhecida" };
    }

    const data = (event && event.data) || {};
    if (type === "connection.update") return this._handleConnection(instance, data);
    if (type === "messages.upsert") return this._handleMessages(instance, data);
    // `qrcode.updated` chega e não tem o que fazer: quem mostra o QR é a tela,
    // que pede um novo a cada renovação.
    return { type: "ignored", reason: `evento ${type || "vazio"}` };
  }

  /** Log de webhook NUNCA leva telefone inteiro (LGPD) — nem o de terceiro. */
  static logSummary(event) {
    const first = messagesOfEvent(event && event.data)[0];
    const msg = first ? readMessage(first) : null;
    return {
      event: String((event && event.event) || ""),
      instance: String((event && event.instance) || ""),
      from: msg ? redactPhone(msg.remoteJid.split("@")[0]) : "",
    };
  }
}

module.exports = WhatsappIngestService;
