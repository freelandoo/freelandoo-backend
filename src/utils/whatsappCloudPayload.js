// src/utils/whatsappCloudPayload.js
// Leitura do payload do webhook da Meta Cloud API. Módulo PURO — irmão do
// `whatsappPayload.js`, que lê o formato Baileys da Evolution.
//
// Ser puro não é detalhe de teste: é o que deixa explícito, no próprio arquivo,
// que INTERPRETAR mensagem não implica RESPONDER mensagem. Este módulo não
// conhece a Graph API, só o formato dela.
//
// ─── A DIFERENÇA QUE MAIS MUDA CÓDIGO: UM WEBHOOK PARA TODOS OS NÚMEROS ─────
//
// Na Evolution cada usuário tem a instância dele e o evento diz `instance`.
// Aqui a Meta entrega TODOS os números da plataforma no MESMO endereço, e o
// único campo que diz de quem é a mensagem é
// `entry[].changes[].value.metadata.phone_number_id`.
//
// ⚠️ É a MESMA armadilha da mig 223, com outro nome: tratar "a instância" no
// singular faz a mensagem de um cliente cair na caixa de outro — sem erro
// nenhum aparecer. Por isso `readEnvelope` devolve uma LISTA de blocos, cada um
// carregando o seu `phoneNumberId`, e nunca um "o número" no singular.
//
// ─── O QUE NÃO EXISTE AQUI ──────────────────────────────────────────────────
//
// • GRUPO: número comercial da Cloud API não participa de grupos. Toda conversa
//   é pessoa a pessoa, e por isso não há `is_group` a decidir.
// • `fromMe`: o que o dono responde pelo celular NÃO vem em `messages[]`. Vem
//   no campo `smb_message_echoes`, que é a coexistência (W3). Enquanto ele não
//   for tratado, a caixa mostra só o lado do cliente — e é melhor que isso
//   fique VISÍVEL num `ignored` com motivo do que escondido num `else`.

const { MEDIA_LABEL } = require("./whatsappPayload");

/**
 * Rótulos do que a Cloud API entrega e o banco não modela como mídia.
 *
 * ⚠️ O `media_type` tem CHECK de lista fechada na mig 223
 * (`text|image|audio|video|document|other`), então localização, contato e
 * reação entram como `other` — e o rótulo é a única coisa que diz ao
 * profissional O QUE chegou. Descartar essas mensagens seria pior: o cliente
 * mandou o endereço, e a caixa mostraria um silêncio.
 */
const KIND_LABEL = {
  location: "📍 Localização",
  contacts: "👤 Contato",
  reaction: "Reação",
  order: "🛒 Pedido",
  sticker: "📷 Figurinha",
  unsupported: "Mensagem não suportada",
};

/** Os quatro tipos que o banco modela como mídia de verdade. */
const MEDIA_KINDS = ["image", "audio", "video", "document"];

function onlyDigits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function textOf(value) {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") return String(value.body ?? "").trim();
  return "";
}

/** Timestamp da Cloud API vem em SEGUNDOS, como string. Torto cai para agora. */
function instant(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return new Date();
  return new Date(n * 1000);
}

/**
 * O texto que representa a mensagem, o tipo que o banco aceita e o id da mídia.
 *
 * O `mediaId` é o que o W4 usa para baixar o binário — a Cloud API entrega só a
 * referência, nunca os bytes. Guardá-lo desde já evita que a mídia recebida
 * antes do W4 fique irrecuperável.
 */
function contentOf(msg) {
  const type = String(msg.type || "").toLowerCase();

  if (type === "text") {
    return { body: textOf(msg.text), mediaType: "text", mediaId: null };
  }

  if (MEDIA_KINDS.includes(type)) {
    const node = msg[type] || {};
    const caption = String(node.caption ?? "").trim();
    // Documento sem legenda ainda tem nome de arquivo, que diz mais que o rótulo.
    const fallback = type === "document" ? String(node.filename ?? "").trim() : "";
    return {
      body: caption || fallback || MEDIA_LABEL[type],
      mediaType: type,
      mediaId: String(node.id ?? "").trim() || null,
    };
  }

  // Figurinha é imagem para quem lê, mas nasce sem legenda.
  if (type === "sticker") {
    return {
      body: KIND_LABEL.sticker,
      mediaType: "image",
      mediaId: String((msg.sticker || {}).id ?? "").trim() || null,
    };
  }

  // Botão e lista: o que importa é o que a pessoa ESCOLHEU.
  if (type === "button") {
    const picked = textOf((msg.button || {}).text);
    return { body: picked || KIND_LABEL.unsupported, mediaType: "text", mediaId: null };
  }

  if (type === "interactive") {
    const i = msg.interactive || {};
    const picked = i.button_reply || i.list_reply || {};
    const title = String(picked.title ?? "").trim();
    return { body: title || KIND_LABEL.unsupported, mediaType: "text", mediaId: null };
  }

  if (type === "location") {
    const l = msg.location || {};
    const name = String(l.name ?? l.address ?? "").trim();
    const label = KIND_LABEL.location;
    return { body: name ? label + " — " + name : label, mediaType: "other", mediaId: null };
  }

  if (type === "reaction") {
    const emoji = String((msg.reaction || {}).emoji ?? "").trim();
    return { body: emoji || KIND_LABEL.reaction, mediaType: "other", mediaId: null };
  }

  if (type === "contacts" || type === "order") {
    return { body: KIND_LABEL[type], mediaType: "other", mediaId: null };
  }

  // Tipo que ainda não existia quando isto foi escrito. Registrar o rótulo é
  // melhor que sumir com a mensagem: o cliente escreveu, e o profissional
  // precisa saber que há algo ali para abrir no celular.
  return { body: KIND_LABEL.unsupported, mediaType: "other", mediaId: null };
}

/**
 * Traduz um item de `value.messages[]` no que persistimos.
 *
 * `nameByWaId` vem de `value.contacts[]`, que é onde a Cloud API põe o nome de
 * perfil — ele NÃO vem dentro da mensagem, como o `pushName` do Baileys vinha.
 *
 * Devolve `null` quando não há nada aproveitável. Nunca lança: payload torto é
 * coisa esperada num webhook público.
 */
function readMessage(raw, nameByWaId) {
  const msg = raw || {};
  const waMessageId = String(msg.id ?? "").trim();
  const phone = onlyDigits(msg.from);
  if (!waMessageId || !phone) return null;

  const { body, mediaType, mediaId } = contentOf(msg);
  if (!body) return null;

  return {
    waMessageId,
    phone,
    // A conversa é modelada por JID desde a mig 223, e a Cloud API entrega só o
    // número. Sintetizar o JID mantém UMA forma de conversa para os dois
    // provedores — sem isso, a mesma tela teria que saber ler dois formatos.
    remoteJid: phone + "@s.whatsapp.net",
    pushName: (nameByWaId && nameByWaId.get(phone)) || "",
    body,
    mediaType,
    mediaId,
    sentAt: instant(msg.timestamp),
  };
}

/**
 * Achata `entry[].changes[]` numa lista de blocos, cada um com o número dono.
 *
 * ⚠️ Devolve LISTA, e não o primeiro bloco: a Meta agrupa várias mudanças — de
 * números DIFERENTES — no mesmo POST. Ler só `entry[0].changes[0]` funcionaria
 * em todo teste manual (onde só existe um número) e perderia mensagens em
 * produção, calado.
 */
function readEnvelope(body) {
  const entries = Array.isArray(body && body.entry) ? body.entry : [];
  const out = [];

  for (const entry of entries) {
    const wabaId = String((entry && entry.id) ?? "").trim();
    const changes = Array.isArray(entry && entry.changes) ? entry.changes : [];

    for (const change of changes) {
      const value = (change && change.value) || {};
      const metadata = value.metadata || {};

      out.push({
        field: String((change && change.field) ?? "").trim(),
        wabaId,
        phoneNumberId: String(metadata.phone_number_id ?? "").trim(),
        messages: Array.isArray(value.messages) ? value.messages : [],
        statuses: Array.isArray(value.statuses) ? value.statuses : [],
        contacts: Array.isArray(value.contacts) ? value.contacts : [],
      });
    }
  }

  return out;
}

/** `value.contacts[]` → mapa wa_id → nome de perfil. */
function namesOf(contacts) {
  const map = new Map();
  for (const c of contacts || []) {
    const waId = onlyDigits(c && c.wa_id);
    const name = String(((c && c.profile) || {}).name ?? "").trim();
    if (waId && name) map.set(waId, name);
  }
  return map;
}

module.exports = { readEnvelope, readMessage, namesOf, KIND_LABEL };
