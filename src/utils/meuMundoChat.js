// src/utils/meuMundoChat.js — MEU MUNDO 3D mm3d-32: regra pura do chat.
//
// O Global do jogo é uma sala do chat ao vivo (mig 303). Aqui fica só o que
// não toca banco nem rede: o que uma linha mostra (projeção campo a campo,
// sem id de usuário — REDE.md), quem recebe (bloqueio em qualquer sentido
// some dos dois lados) e o texto do balão sobre a cabeça.

const BUBBLE_MAX = 90;

// Entrada = mensagem já mapeada pelo ChatService (mapMessage): o conteúdo
// gravado já é o mascarado quando a moderação mascarou.
function authorOf(m) {
  return m && m.sender ? m.sender.id_user : null;
}

function toLine(m, { viewerId, sessionOf } = {}) {
  if (!m || m.hidden) return null;
  const author = authorOf(m);
  const mine = String(author) === String(viewerId);
  const p = m.profile || {};
  const username = m.sender && m.sender.username;
  const name = (p.display_name || "").trim() || (username ? `@${username}` : "Jogador");
  return {
    id: m.id_chat_message,
    text: m.content || "",
    at: m.created_at || null,
    name,
    avatar: p.avatar_url || null,
    profileId: p.id_profile || null,
    // Só quem está na MESMA sala de quem lê ganha sessão (balão e card).
    session: !mine && sessionOf ? sessionOf(author) || null : null,
    mine,
  };
}

function recipients(online, senderId, blockPairs) {
  const out = new Set();
  const cut = new Set();
  for (const p of blockPairs || []) {
    const a = String(p.blocker_user_id);
    const b = String(p.blocked_user_id);
    if (a === String(senderId)) cut.add(b);
    if (b === String(senderId)) cut.add(a);
  }
  for (const u of online) if (!cut.has(String(u))) out.add(u);
  return [...out];
}

function bubbleText(raw) {
  const s = String(raw || "").replace(/\s+/g, " ").trim();
  return s.length > BUBBLE_MAX ? `${s.slice(0, BUBBLE_MAX - 1)}…` : s;
}

module.exports = { toLine, authorOf, recipients, bubbleText, BUBBLE_MAX };
