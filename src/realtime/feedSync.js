// Feed Interativo F6 (mig 459): a sala do feed sincronizado no socket social.
//
//   sync:join  {id_session}  → só participante de sessão ATIVA entra (regra 14:
//                              inscrição de socket confere permissão)
//   sync:state {id_session, seq, index, post_id, post_ids?, video?}
//                            → repassado ao OUTRO lado como fi:sync:state.
//                              Quem pode mandar: o anfitrião; o convidado só
//                              com controle dividido. Até 15 por segundo.
//   sync:leave {id_session}
//   fi:sync:peer {id_session, id_user, online} avisa entrada/saída.
//
// Cache da sessão por processo (o backend é processo único, como o Colyseus):
// FeedSyncService.sessionChanged atualiza ao aceitar/encerrar/trocar controle.

const { createLogger } = require("../utils/logger");

const log = createLogger("feedSync");
const room = (id) => `sync:${id}`;
const cache = new Map(); // id_session → { id_host, id_guest, control, status }
let ioRef = null;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PER_SEC = 15;

function sessionChanged(row) {
  if (!row?.id_session) return;
  if (row.status === "ended") {
    cache.delete(row.id_session);
    if (ioRef) {
      ioRef.in(room(row.id_session)).socketsLeave(room(row.id_session));
    }
    return;
  }
  cache.set(row.id_session, { id_host: row.id_host, id_guest: row.id_guest, control: row.control, status: row.status });
}

function clampState(p) {
  const out = {
    id_session: p.id_session,
    seq: Number.isFinite(p.seq) ? Math.trunc(p.seq) : 0,
    index: Number.isFinite(p.index) ? Math.max(0, Math.min(10_000, Math.trunc(p.index))) : 0,
    post_id: typeof p.post_id === "string" && UUID_RE.test(p.post_id) ? p.post_id : null,
  };
  if (Array.isArray(p.post_ids)) {
    out.post_ids = p.post_ids.filter((x) => typeof x === "string" && UUID_RE.test(x)).slice(0, 30);
  }
  if (p.video && typeof p.video === "object") {
    out.video = {
      playing: !!p.video.playing,
      t: Number.isFinite(p.video.t) ? Math.max(0, Math.min(36_000, p.video.t)) : 0,
    };
  }
  if (p.scroll != null && Number.isFinite(p.scroll)) out.scroll = Math.max(-1, Math.min(1, p.scroll));
  return out;
}

function attach(io, socket) {
  ioRef = io;
  const id_user = socket.data.id_user;
  socket.data.syncRooms = new Set();
  let bucket = MAX_PER_SEC;
  let bucketAt = Date.now();

  socket.on("sync:join", async (payload) => {
    const id = payload?.id_session;
    if (typeof id !== "string" || !UUID_RE.test(id)) return;
    try {
      const FeedSyncService = require("../services/FeedSyncService");
      const s = await FeedSyncService.membership(id, id_user);
      if (!s) return;
      sessionChanged(s);
      socket.join(room(id));
      socket.data.syncRooms.add(id);
      socket.to(room(id)).emit("fi:sync:peer", { id_session: id, id_user, online: true });
      // Quem já está na sala responde com o estado atual (o cliente do host reenvia).
      socket.emit("fi:sync:peer", { id_session: id, id_user, online: true, self: true });
    } catch (err) {
      log.warn("sync.join_fail", { message: err?.message });
    }
  });

  socket.on("sync:leave", (payload) => {
    const id = payload?.id_session;
    if (typeof id !== "string" || !socket.data.syncRooms.has(id)) return;
    socket.leave(room(id));
    socket.data.syncRooms.delete(id);
    socket.to(room(id)).emit("fi:sync:peer", { id_session: id, id_user, online: false });
  });

  socket.on("sync:state", (payload) => {
    const id = payload?.id_session;
    if (typeof id !== "string" || !socket.data.syncRooms.has(id)) return;
    const s = cache.get(id);
    if (!s || s.status !== "active") return;
    const isHost = s.id_host === id_user;
    if (!isHost && s.control !== "shared") return;
    const now = Date.now();
    bucket = Math.min(MAX_PER_SEC, bucket + ((now - bucketAt) / 1000) * MAX_PER_SEC);
    bucketAt = now;
    if (bucket < 1) return;
    bucket -= 1;
    socket.to(room(id)).emit("fi:sync:state", { ...clampState(payload), from: id_user, sent_at: now });
  });

  socket.on("disconnect", () => {
    for (const id of socket.data.syncRooms || []) {
      socket.to(room(id)).emit("fi:sync:peer", { id_session: id, id_user, online: false });
    }
  });
}

module.exports = { attach, sessionChanged, _cache: cache };
