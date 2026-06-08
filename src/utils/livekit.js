// src/utils/livekit.js
// Wrapper fino do livekit-server-sdk para emitir tokens de acesso a salas.
// Single source de config: LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET.
// O ws_url volta junto com o token pro front (o front não tem env própria).
//
// Dev local (Docker --dev): ws://localhost:7880, devkey/secret.
const { AccessToken, RoomServiceClient } = require("livekit-server-sdk");
const { createLogger } = require("./logger");

const log = createLogger("livekit");

const LIVEKIT_URL = process.env.LIVEKIT_URL || "ws://localhost:7880";
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || "devkey";
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || "secret";

// Salas de live nunca duram mais que algumas horas; token expira em 6h.
const TOKEN_TTL = "6h";

function getWsUrl() {
  return LIVEKIT_URL;
}

// HTTP(S) URL do mesmo host (RoomService usa http, não ws).
function getHttpUrl() {
  return LIVEKIT_URL.replace(/^ws/, "http");
}

async function buildToken({ room, identity, name, canPublish }) {
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity,
    name: name || identity,
    ttl: TOKEN_TTL,
  });
  at.addGrant({
    roomJoin: true,
    room,
    canPublish: !!canPublish,
    canSubscribe: true,
    // Presentes/chat trafegam por data channel — ambos os papéis publicam dados.
    canPublishData: true,
  });
  return at.toJwt();
}

// Token do transmissor: pode publicar câmera/mic + dados.
function broadcasterToken(room, identity, name) {
  return buildToken({ room, identity, name, canPublish: true });
}

// Token do espectador: só assina mídia (mas pode mandar dados p/ chat/presentes).
function viewerToken(room, identity, name) {
  return buildToken({ room, identity, name, canPublish: false });
}

// Encerra a sala no servidor LiveKit (derruba todos). Best-effort: nunca derruba
// o fluxo da aplicação se o LiveKit estiver indisponível.
async function deleteRoom(room) {
  try {
    const svc = new RoomServiceClient(
      getHttpUrl(),
      LIVEKIT_API_KEY,
      LIVEKIT_API_SECRET
    );
    await svc.deleteRoom(room);
    return true;
  } catch (err) {
    log.warn("deleteRoom.failed", { room, message: err?.message });
    return false;
  }
}

module.exports = {
  getWsUrl,
  getHttpUrl,
  broadcasterToken,
  viewerToken,
  deleteRoom,
};
