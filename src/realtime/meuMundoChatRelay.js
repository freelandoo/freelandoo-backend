// src/realtime/meuMundoChatRelay.js — MEU MUNDO 3D mm3d-32: entrega do chat
// pelas salas do jogo. Só lê a presença (quem está em que sala, com que
// sessão); não carrega Colyseus nem banco, para poder ser testado sozinho.
// meuMundo.js reexporta estas funções.

const presence = require("./meuMundoPresence");

/**
 * Chat Global do jogo: uma linha para quem está numa sala agora.
 * O MeuMundoChatService já filtrou quem bloqueou/foi bloqueado.
 */
function pushChat(userId, line) {
  return presence.send(userId, "chat", line);
}

/** sessionId de `userId` na sala em que `viewerId` está (null = outra sala). */
function sessionOf(viewerId, userId) {
  const p = presence.get(viewerId);
  const q = presence.get(userId);
  if (!p || !q || p.room !== q.room) return null;
  return q.sessionId;
}

/**
 * Balão sobre a cabeça: só para quem está na MESMA sala de quem falou e passa
 * em `canSee(userId)` (bloqueio). Vai com sessionId, nunca com id de conta.
 */
function sayInRoom(userId, text, canSee) {
  const p = presence.get(userId);
  if (!p || !p.room || !p.room.sim) return 0;
  let n = 0;
  for (const c of p.room.clients) {
    const s = p.room.sim.get(c.sessionId);
    if (!s || !s.userId || s.userId === userId || !canSee(s.userId)) continue;
    c.send("say", { s: p.sessionId, t: text });
    n++;
  }
  return n;
}

module.exports = { pushChat, sessionOf, sayInRoom };
