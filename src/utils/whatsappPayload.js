// src/utils/whatsappPayload.js
// Leitura do payload do webhook da Evolution (formato Baileys). Módulo PURO.
//
// Copiado do Coliseu (`src/lib/whatsapp/payload.ts`). Ser puro não é detalhe de
// teste: é o que deixa explícito, no próprio arquivo, que INTERPRETAR mensagem
// não implica RESPONDER mensagem — este módulo não conhece a Evolution, só o
// formato dela.

/** Rótulo do histórico quando a mídia vem sem legenda. O binário fica na Evolution. */
const MEDIA_LABEL = {
  image: "📷 Imagem",
  audio: "🎤 Áudio",
  video: "🎬 Vídeo",
  document: "📎 Documento",
  other: "Mensagem não suportada",
};

function textOf(value) {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    return String(value.text ?? value.caption ?? value.selectedDisplayText ?? "").trim();
  }
  return "";
}

function classify(message) {
  if (message.imageMessage) return { type: "image", caption: textOf(message.imageMessage) };
  if (message.stickerMessage) return { type: "image", caption: "" };
  if (message.audioMessage) return { type: "audio", caption: "" };
  if (message.videoMessage) return { type: "video", caption: textOf(message.videoMessage) };
  if (message.documentMessage) return { type: "document", caption: textOf(message.documentMessage) };
  return { type: "text", caption: "" };
}

/** O texto que representa uma mensagem: direto, legenda da mídia ou rótulo. */
function contentOf(message) {
  const direct =
    textOf(message.conversation) ||
    textOf(message.extendedTextMessage) ||
    textOf(message.buttonsResponseMessage) ||
    textOf(message.listResponseMessage && message.listResponseMessage.title);

  const { type, caption } = classify(message);
  return {
    body: type === "text" ? direct : caption || direct || MEDIA_LABEL[type],
    mediaType: type,
  };
}

/** Timestamp do WhatsApp vem em SEGUNDOS; ausente ou torto cai para agora. */
function instant(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return new Date();
  return new Date(n * 1000);
}

/**
 * Traduz um item de `messages.upsert` no que persistimos.
 * Devolve `null` quando não há nada aproveitável — sem id, sem endereço ou sem
 * conteúdo. Nunca lança: payload torto é coisa esperada num webhook público.
 */
function readMessage(raw) {
  const msg = raw || {};
  const key = msg.key || {};
  const waMessageId = String(key.id ?? "").trim();

  // `remoteJidAlt` traz o JID de telefone quando o principal é @lid. Em grupo o
  // endereço da conversa é o do GRUPO: ali o alt é do participante, e usá-lo
  // espalharia a conversa do grupo em uma conversa por pessoa que escreve.
  const jid = String(key.remoteJid ?? "").trim();
  const remoteJid = /@g\.us$/i.test(jid) ? jid : String(key.remoteJidAlt || jid).trim();
  if (!waMessageId || !remoteJid) return null;

  const message = msg.message;
  if (!message || typeof message !== "object") return null;

  const { body, mediaType } = contentOf(message);
  // Mídia sem legenda ainda vale registro (vira rótulo); texto vazio sem mídia, não.
  if (!body) return null;

  return {
    waMessageId,
    remoteJid,
    fromMe: !!key.fromMe,
    // Nome de perfil de quem escreveu. Em grupo é do PARTICIPANTE, não do grupo.
    pushName: String(msg.pushName ?? "").trim(),
    participant: String(key.participantAlt || key.participant || "").trim(),
    body,
    mediaType,
    sentAt: instant(msg.messageTimestamp),
  };
}

/** A Evolution manda ora `data.messages[]`, ora `data` direto. */
function messagesOfEvent(data) {
  if (Array.isArray(data)) return data;
  const d = data || {};
  if (Array.isArray(d.messages)) return d.messages;
  return data ? [data] : [];
}

/** Estado bruto do `connection.update` normalizado. */
function isConnectionOpen(state) {
  return ["open", "connected", "connection_open"].includes(String(state ?? "").toLowerCase());
}

module.exports = { readMessage, messagesOfEvent, isConnectionOpen, MEDIA_LABEL };
