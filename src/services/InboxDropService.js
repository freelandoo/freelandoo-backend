// src/services/InboxDropService.js
// Uma mensagem deixada na caixa da Freelandoo PELO SISTEMA, em nome de alguém.
//
// Nasceu no aviso de agendamento do site (mig 227, BookingAlertService) e virou
// peça própria quando a Loja passou a abrir a conversa de retirada (mig 264):
// escrita duas vezes, a projeção do socket divergiria na primeira mudança.
//
// ⚠️ QUEM ASSINA É UMA PESSOA (o cliente, o comprador), e é uma escolha: assim a
// conversa abre no lugar onde o outro lado pode RESPONDER. Um remetente-sistema
// produziria uma linha que ninguém consegue responder.
//
// Vai pelo storage, e não pelo `ConversationService.sendMessage`: aquele caminho
// exige usuário AUTENTICADO na requisição, aplica limite de envio e checa
// supervisão — regras de alguém digitando. Aqui quem escreve é o sistema,
// dentro de um webhook, sem ninguém na tela.

const pool = require("../databases");
const ProfileStorage = require("../storages/ProfileStorage");
const ConversationStorage = require("../storages/ConversationStorage");
const MessageStorage = require("../storages/MessageStorage");
const ConversationService = require("./ConversationService");
const realtime = require("../realtime/socket");

class InboxDropService {
  /**
   * @param {object} p
   * @param {string} p.from_user_id    quem assina a mensagem
   * @param {string} p.to_user_id      dono da caixa que recebe
   * @param {string} [p.to_profile_id] perfil que recebe (ex.: o da loja); sem
   *                                   ele, o perfil-conta do destinatário
   * @param {string} p.text
   * @returns {Promise<string|null>} id da conversa, ou null quando não há
   *                                 como abrir (perfil ausente, a si mesmo)
   */
  static async send({ from_user_id, to_user_id, to_profile_id = null, text }) {
    if (!from_user_id || !to_user_id || !text) return null;

    const senderProfile = await ProfileStorage.getUserAccountProfileId(pool, from_user_id);
    const recipientProfile =
      to_profile_id || (await ProfileStorage.getUserAccountProfileId(pool, to_user_id));
    if (!senderProfile || !recipientProfile) return null;
    // Não existe conversa de alguém consigo mesmo.
    if (String(from_user_id) === String(to_user_id)) return null;
    if (String(senderProfile) === String(recipientProfile)) return null;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { conversation } = await ConversationStorage.getOrCreate(
        client,
        senderProfile,
        recipientProfile
      );
      const message = await MessageStorage.create(client, {
        id_conversation: conversation.id_conversation,
        sender_entity_id: senderProfile,
        sender_user_id: from_user_id,
        body: text,
      });
      await ConversationStorage.updateLastMessage(client, {
        id_conversation: conversation.id_conversation,
        sender_entity_id: senderProfile,
        body: text,
        at: message.created_at,
      });
      // O destinatário ganha o não-lido; quem "assina" não deve ver badge de uma
      // mensagem que ele não digitou.
      await ConversationStorage.incrementUnreadForOther(client, {
        id_conversation: conversation.id_conversation,
        sender_entity_id: senderProfile,
      });
      await ConversationStorage.markRead(client, {
        id_conversation: conversation.id_conversation,
        entity_id: senderProfile,
      });
      await client.query("COMMIT");

      try {
        realtime.emitToConversation(conversation.id_conversation, "conversation:message", {
          id_conversation: conversation.id_conversation,
          // A MESMA projeção do envio normal.
          message: ConversationService.mapMessage(message),
        });
        realtime.emitToUser(to_user_id, "nav-counts:changed", {
          reason: "message_received",
          id_conversation: conversation.id_conversation,
        });
      } catch {
        /* realtime é best-effort */
      }

      return conversation.id_conversation;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}

module.exports = InboxDropService;
