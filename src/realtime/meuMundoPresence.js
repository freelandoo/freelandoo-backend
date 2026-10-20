// src/realtime/meuMundoPresence.js — MEU MUNDO 3D: onde cada jogador está AGORA.
//
// Uma pessoa tem no máximo UM avatar ativo: na rua de um bairro OU dentro de
// uma casa. Toda sala (bairro ou casa) registra aqui quem entrou; se a mesma
// pessoa aparece numa segunda sala, a presença anterior é encerrada (aviso
// "aberto em outra janela"). É também por aqui que o servidor alcança alguém
// para entregar um convite ou encerrar uma visita, sem saber em que sala ela
// está.
//
// `placement` lembra o último destino AUTORIZADO de cada um (rua de qual
// bairro, com chegada em frente a qual casa; ou dentro de qual casa). É o que
// faz a atualização da página e a reconexão voltarem ao lugar certo, e o que
// a transição entre ambientes escreve antes de reservar a sala seguinte.
//
// ⚠️ Memória do PROCESSO (como o matchmaker do Colyseus): reiniciar o servidor
// zera presença e destinos — todo mundo volta à frente da própria casa (ou da
// casa visitada, se a visita ainda estiver valendo). Mais de uma réplica exige
// um armazenamento compartilhado (Redis), anotado no REGISTRO.md.

const presence = new Map(); // userId → { scene, id, room, sessionId, since }
const offlineSince = new Map(); // userId → ms (saiu de todas as salas)
const placement = new Map(); // userId → { scene, nbId?, houseId?, arrivalLot?, at }
const bootAt = Date.now();

function claim(userId, room, sessionId, scene, id) {
  const prev = presence.get(userId);
  if (prev && !(prev.room === room && prev.sessionId === sessionId)) {
    // Mesma pessoa em outra sala: a presença antiga sai (uma por pessoa).
    if (prev.room !== room) {
      const c = prev.room.clients.find((cl) => cl.sessionId === prev.sessionId);
      if (c) {
        c.send("replaced", {});
        c.leave(4009);
      }
      prev.room.dropSession?.(prev.sessionId);
    }
  }
  presence.set(userId, { scene, id, room, sessionId, since: Date.now() });
  offlineSince.delete(userId);
}

function release(userId, room, sessionId) {
  const cur = presence.get(userId);
  if (cur && cur.room === room && cur.sessionId === sessionId) {
    presence.delete(userId);
    offlineSince.set(userId, Date.now());
  }
}

function get(userId) {
  return presence.get(userId) || null;
}

/** Há quanto tempo a pessoa está fora de todas as salas (0 = online). */
function offlineFor(userId, now = Date.now()) {
  if (presence.has(userId)) return 0;
  const since = offlineSince.get(userId) ?? bootAt;
  return now - since;
}

/** Envia uma mensagem a quem estiver conectado (em qualquer sala). */
function send(userId, type, payload) {
  const p = presence.get(userId);
  if (!p) return false;
  const c = p.room.clients.find((cl) => cl.sessionId === p.sessionId);
  if (!c) return false;
  c.send(type, payload);
  return true;
}

/** Tira a pessoa da sala em que está (com aviso), se for a sala indicada. */
function kick(userId, { scene, id, code, message }) {
  const p = presence.get(userId);
  if (!p || (scene && p.scene !== scene) || (id && p.id !== id)) return false;
  const c = p.room.clients.find((cl) => cl.sessionId === p.sessionId);
  if (c) {
    if (message) c.send(message.type, message.payload);
    c.leave(code);
  }
  return true;
}

function onlineUsers() {
  return [...presence.keys()];
}

function setPlacement(userId, place) {
  placement.set(userId, { ...place, at: Date.now() });
}

function getPlacement(userId) {
  return placement.get(userId) || null;
}

// Só para a suíte e2e.
function _reset() {
  presence.clear();
  offlineSince.clear();
  placement.clear();
}

module.exports = { claim, release, get, offlineFor, send, kick, onlineUsers, setPlacement, getPlacement, _reset };
