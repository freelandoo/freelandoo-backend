// src/utils/whatsappConversation.js
//
// A projeção pública de uma conversa — a MESMA nos dois caminhos que alimentam
// a lista da caixa de entrada.
//
// ─── POR QUE ISTO É UM UTIL, E NÃO UM MÉTODO DE SERVICE ─────────────────────
//
// A lista é alimentada por DOIS caminhos: a leitura (`GET /whatsapp/
// conversations`, pelo `WhatsappService`) e o PUSH (`whatsapp:message`, pelo
// `WhatsappIngestService`). Enquanto cada um montava o objeto à mão, os dois
// divergiram — e o defeito foi exatamente o que esta regra prevê: a leitura
// devolvia `title`/`phone_display` e o push mandava `push_name`/`phone`, então
// a conversa que chegava ao vivo aparecia como "Contato sem nome" e a MESMA
// conversa, depois de um F5, aparecia com o nome certo.
//
// O dado estava correto no banco o tempo todo. O que estava errado era haver
// duas respostas para "como uma conversa se apresenta".
//
// ⚠️ O util existe porque o `WhatsappIngestService` NÃO PODE importar o
// `WhatsappService`: aquele importa `integrations/whatsappProvider`, o único
// lugar que ENVIA, e é a ausência desse caminho de código que sustenta que
// ninguém é respondido automaticamente pelo WhatsApp de um usuário. Uma função
// pura, sem provedor e sem banco, serve aos dois sem furar o isolamento.

const { formatPhone } = require("./whatsappJid");

/**
 * @param {object} c linha de `tb_whatsapp_conversation`
 */
function publicConversation(c) {
  if (!c) return null;
  return {
    id_conversation: c.id_conversation,
    phone: c.phone || "",
    phone_display: formatPhone(c.phone),
    // Sem nome de perfil, o telefone formatado é o melhor título. Sem os dois
    // (grupo sem assunto sincronizado), a tela decide o rótulo.
    title: c.push_name || formatPhone(c.phone) || "",
    is_group: !!c.is_group,
    unread_count: c.unread_count || 0,
    last_message_at: c.last_message_at,
    last_message_preview: c.last_message_preview || "",
    // A janela de 24h da Cloud API — `null` quando não se aplica (Evolution não
    // tem janela). É a tela que desabilita o campo, mas quem RECUSA de verdade
    // é o service: espelho que erra esconde um botão, nunca abre uma porta.
    service_window_expires_at: c.service_window_expires_at || null,
  };
}

module.exports = { publicConversation };
