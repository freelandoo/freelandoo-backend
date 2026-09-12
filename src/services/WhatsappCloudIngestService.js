// src/services/WhatsappCloudIngestService.js
// Ingestão do webhook da Meta Cloud API (mig 240): o que CHEGA.
//
// ─── INVARIANTE DO SUBSISTEMA (o mesmo do irmão da Evolution) ───────────────
//
// Este módulo NÃO importa `integrations/whatsappProvider` nem `WhatsappService`
// — os lugares que sabem ENVIAR. Não existe caminho de código daqui até um
// `sendText`, e é isso, e não uma regra escrita, que garante que ninguém é
// respondido automaticamente pelo WhatsApp de um usuário da Freelandoo.
//
// Aqui isso pesa MAIS que na Evolution: o número está no NOSSO Business
// Portfolio. Uma resposta automática disparada por nós seria, perante a Meta,
// a plataforma operando ferramenta de disparo — com o portfólio inteiro, e
// portanto o número de todos os clientes, no mesmo risco.
//
// `test/unit/whatsappIngestIsolation.test.js` lê os `require` de verdade e
// quebra se alguém acrescentar um import de passagem.
//
// ─── DE QUEM É ESTA MENSAGEM ────────────────────────────────────────────────
//
// A Meta entrega TODOS os números no mesmo endereço. A resposta legítima está
// em UM campo: `value.metadata.phone_number_id`, casado com
// `tb_whatsapp_instance` pelo par (provider='cloud', evolution_instance).
// Número desconhecido é IGNORADO — nunca atribuído a alguém.

const pool = require("../databases");
const WhatsappStorage = require("../storages/WhatsappStorage");
const realtime = require("../realtime/socket");
const { readEnvelope, readMessage, namesOf } = require("../utils/whatsappCloudPayload");
const { redactPhone } = require("../utils/whatsappJid");
const { createLogger } = require("../utils/logger");

const log = createLogger("WhatsappCloudIngestService");

const PROVIDER = "cloud";

/** A janela de atendimento da Meta: 24h a contar da mensagem do cliente. */
const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

class WhatsappCloudIngestService {
  /**
   * Mensagens de um bloco já resolvido para um dono.
   *
   * ⚠️ `direction` é SEMPRE `in`. Diferente do Baileys, `messages[]` da Cloud
   * API traz só o que o CLIENTE mandou — o que o dono responde pelo celular
   * dele chega em `smb_message_echoes`, tratado no W3. Marcar qualquer coisa
   * daqui como `out` inverteria o autor da bolha na tela.
   */
  static async _handleMessages(instance, block) {
    const names = namesOf(block.contacts);
    let saved = 0;
    let duplicated = 0;

    for (const raw of block.messages) {
      const msg = readMessage(raw, names);
      if (!msg) continue;

      const conversation = await WhatsappStorage.ensureConversation(pool, {
        id_instance: instance.id_instance,
        remote_jid: msg.remoteJid,
        phone: msg.phone,
        push_name: msg.pushName,
        // Número comercial da Cloud API não participa de grupo. Não é um
        // default preguiçoso: é uma propriedade do canal.
        is_group: false,
      });

      const row = await WhatsappStorage.insertMessage(pool, {
        id_conversation: conversation.id_conversation,
        wa_message_id: msg.waMessageId,
        direction: "in",
        sender_label: null,
        body: msg.body,
        media_type: msg.mediaType,
        sent_at: msg.sentAt,
      });

      // A Meta entrega at-least-once: a repetição é esperada, e o UNIQUE de
      // `wa_message_id` é o que a torna inofensiva. Contar em vez de logar
      // mantém o sinal sem encher o log de um evento normal.
      if (!row) {
        duplicated++;
        continue;
      }
      saved++;

      // ⚠️ A JANELA DE 24H NASCE AQUI, e este é o único lugar que pode
      // abri-la: é o webhook que sabe quando o cliente falou. Calcular no
      // envio seria adivinhar, e adivinhar para o lado aberto faz a tela
      // prometer um envio que a Meta vai recusar.
      await WhatsappStorage.touchConversation(pool, conversation.id_conversation, {
        preview: msg.body,
        sent_at: msg.sentAt,
        inc_unread: true,
        service_window_expires_at: new Date(msg.sentAt.getTime() + SERVICE_WINDOW_MS),
      });

      // Mesmo evento que a Evolution emite: a caixa de entrada é UMA só, e a
      // tela não deve precisar saber por qual provedor a mensagem entrou.
      realtime.emitToUser(instance.id_user, "whatsapp:message", {
        id_conversation: conversation.id_conversation,
        message: row,
        conversation: {
          id_conversation: conversation.id_conversation,
          remote_jid: conversation.remote_jid,
          phone: conversation.phone,
          push_name: conversation.push_name,
          is_group: false,
          last_message_preview: msg.body.slice(0, 300),
          last_message_at: msg.sentAt,
        },
      });
    }

    return { saved, duplicated };
  }

  /**
   * Ponto de entrada. Recebe o corpo JÁ PARSEADO — quem confere a assinatura
   * sobre os bytes crus é o controller, antes de chamar isto.
   *
   * Devolve um resumo agregado: um POST pode trazer blocos de números
   * diferentes, e o controller responde 200 uma vez só.
   */
  static async process(body) {
    const blocks = readEnvelope(body);
    if (!blocks.length) return { type: "ignored", reason: "envelope sem mudanças" };

    let saved = 0;
    let duplicated = 0;
    let statuses = 0;
    const ignored = [];

    for (const block of blocks) {
      // `field` diz o que a mudança é. Só `messages` traz conversa; o resto
      // (qualidade do número, status de template, conta) é do W6.
      if (block.field !== "messages") {
        ignored.push(block.field || "vazio");
        continue;
      }

      if (!block.phoneNumberId) {
        ignored.push("bloco sem phone_number_id");
        continue;
      }

      const instance = await WhatsappStorage.getInstanceByRef(
        pool,
        PROVIDER,
        block.phoneNumberId
      );

      // Número que não é nosso (ou que já saiu do banco). Ignorar é a única
      // resposta correta: atribuir a alguém seria entregar a conversa de um
      // desconhecido para um usuário qualquer.
      if (!instance) {
        log.warn("cloud.unknown_number", { phone_number_id: block.phoneNumberId });
        ignored.push("número desconhecido");
        continue;
      }

      const r = await this._handleMessages(instance, block);
      saved += r.saved;
      duplicated += r.duplicated;

      // `statuses[]` são recibos (enviado/entregue/lido/falhou) do que NÓS
      // mandamos. Contados e não gravados de propósito: não há coluna de
      // estado em `tb_whatsapp_message` (mig 223), e inventar uma exigiria
      // migration. Contar deixa o número visível no log quando o W4 chegar,
      // em vez de o recibo sumir sem rastro.
      statuses += block.statuses.length;
    }

    return { type: "messages", saved, duplicated, statuses, ignored };
  }

  /** Log de webhook NUNCA leva telefone inteiro (LGPD) — nem o de terceiro. */
  static logSummary(body) {
    const blocks = readEnvelope(body);
    const first = blocks[0] || {};
    const msg = (first.messages || [])[0];
    return {
      blocks: blocks.length,
      field: first.field || "",
      phone_number_id: first.phoneNumberId || "",
      from: msg ? redactPhone(String(msg.from || "")) : "",
    };
  }
}

module.exports = WhatsappCloudIngestService;
