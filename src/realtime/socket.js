const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { createLogger } = require("../utils/logger");

const log = createLogger("realtime");

let io = null;

const userRoom = (id_user) => `user:${id_user}`;
const conversationRoom = (id_conversation) => `conv:${id_conversation}`;
const chatRoom = (id_chat_room) => `chat:${id_chat_room}`;
const clusterRoom = (id_live_cluster) => `cluster:${id_live_cluster}`;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ─── Endurecimento do socket social (Módulo 09 da Arena) ─────────────────────
// Origem: CORS não protege WebSocket, então a ORIGEM do upgrade é conferida
// aqui. Navegador sempre manda Origin; cliente sem Origin (servidor, teste) é
// aceito porque ele ainda precisa de um token válido. Lista = domínios da
// Freelandoo + localhost de desenvolvimento + REALTIME_ALLOWED_ORIGINS (vírgula).
const ORIGIN_RE = /^https:\/\/([a-z0-9-]+\.)*freelandoo\.com\.br$/i;
const DEV_ORIGIN_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;
function extraOrigins() {
  return String(process.env.REALTIME_ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
function originAllowed(origin) {
  if (!origin) return true;
  if (ORIGIN_RE.test(origin)) return true;
  if (process.env.NODE_ENV !== "production" && DEV_ORIGIN_RE.test(origin)) return true;
  return extraOrigins().includes(origin);
}
// Revalidação proporcional ao risco: a cada 5 min, conta bloqueada/inativa é
// desconectada e salas que deixaram de ser permitidas são deixadas.
const REVALIDATE_MS = 5 * 60_000;
let revalidateTimer = null;

// Presença do chat ao vivo derivada da conexão WebSocket: enquanto houver
// socket inscrito na sala, renovamos tb_chat_presence server-side — o front
// não precisa mais do POST /heartbeat de 60s (era 60 requests/h por user).
// O sweep roda abaixo da janela ONLINE_WINDOW_SECONDS (60s) do ChatStorage.
const PRESENCE_SWEEP_MS = 40_000;
let presenceSweepTimer = null;

// require tardio: evita ciclo (services → realtime/socket → storages).
function chatDeps() {
  const pool = require("../databases");
  const ChatStorage = require("../storages/ChatStorage");
  return { pool, ChatStorage };
}

async function touchChatPresence(id_chat_room, id_user) {
  const { pool, ChatStorage } = chatDeps();
  await ChatStorage.upsertPresence(pool, { id_chat_room, id_user });
  return ChatStorage.countOnline(pool, id_chat_room);
}

async function dropChatPresence(id_chat_room, id_user) {
  const { pool, ChatStorage } = chatDeps();
  // Outra aba do mesmo user pode continuar na sala — só remove a presença
  // se este era o último socket dele inscrito nessa sala.
  const still = await io
    .in(chatRoom(id_chat_room))
    .fetchSockets()
    .then((sockets) => sockets.some((s) => s.data?.id_user === id_user))
    .catch(() => false);
  if (!still) {
    await ChatStorage.removePresence(pool, { id_chat_room, id_user });
  }
  return ChatStorage.countOnline(pool, id_chat_room);
}

// Renova a presença de todos os sockets inscritos em salas de chat e empurra
// a contagem de online pra sala (substitui o heartbeat HTTP do front).
async function sweepChatPresence() {
  if (!io) return;
  try {
    const { pool, ChatStorage } = chatDeps();
    const rooms = io.sockets.adapter.rooms;
    for (const [name] of rooms) {
      if (!name.startsWith("chat:")) continue;
      const id_chat_room = name.slice("chat:".length);
      const sockets = await io.in(name).fetchSockets();
      const users = new Set();
      for (const s of sockets) {
        if (s.data?.id_user) users.add(s.data.id_user);
      }
      for (const id_user of users) {
        await ChatStorage.upsertPresence(pool, { id_chat_room, id_user });
      }
      const online = await ChatStorage.countOnline(pool, id_chat_room);
      io.to(name).emit("chat:presence", { id_chat_room, current_users: online });
    }
  } catch (err) {
    log.warn("chat_presence.sweep_fail", { message: err?.message });
  }
}

// Presença do Cluster de Live: lista de users com socket inscrito na sala.
// Empurrada a cada subscribe/unsubscribe/disconnect — a sala de comando do
// admin mostra quem está conectado sem nenhum poll HTTP.
async function emitClusterPresence(id_live_cluster) {
  if (!io) return;
  try {
    const sockets = await io.in(clusterRoom(id_live_cluster)).fetchSockets();
    const users = [...new Set(sockets.map((s) => s.data?.id_user).filter(Boolean))];
    io.to(clusterRoom(id_live_cluster)).emit("cluster:presence", {
      id_live_cluster,
      user_ids: users,
    });
  } catch (err) {
    log.warn("cluster_presence.fail", { id_live_cluster, message: err?.message });
  }
}

function init(httpServer) {
  if (io) return io;

  io = new Server(httpServer, {
    path: "/realtime",
    cors: {
      origin: (origin, callback) => callback(null, originAllowed(origin)),
      methods: ["GET", "POST"],
      credentials: true,
    },
    allowRequest: (req, callback) => callback(null, originAllowed(req.headers.origin)),
    pingInterval: 25_000,
    pingTimeout: 60_000,
    maxHttpBufferSize: 1e6,
    transports: ["websocket", "polling"],
  });

  io.use((socket, next) => {
    // Token só no `auth` do handshake (ou cabeçalho, para cliente de
    // servidor) — NUNCA na URL: querystring vai parar em log de proxy.
    const token =
      socket.handshake.auth?.token ||
      (socket.handshake.headers?.authorization || "").split(" ")[1];
    if (!token || typeof token !== "string") return next(new Error("missing_token"));
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
    } catch {
      return next(new Error("invalid_token"));
    }
    if (!decoded?.id_user) return next(new Error("invalid_token"));
    // Conta sancionada ou desativada não abre socket (o JWT sozinho não sabe).
    accountUsable(decoded.id_user)
      .then((usable) => {
        if (!usable) return next(new Error("account_unavailable"));
        socket.user = { id_user: decoded.id_user, email: decoded.email };
        socket.data.tokenExp = Number.isInteger(decoded.exp) ? decoded.exp * 1000 : null;
        return next();
      })
      .catch(() => next(new Error("identity_unavailable")));
  });

  io.on("connection", (socket) => {
    const id_user = socket.user?.id_user;
    if (!id_user) return socket.disconnect(true);
    socket.join(userRoom(id_user));
    socket.data.id_user = id_user;
    socket.data.chatRooms = new Set();
    socket.data.clusterRooms = new Set();
    socket.data.convRooms = new Set();
    // A conexão não vive além da credencial que a autorizou.
    if (socket.data.tokenExp) {
      const left = socket.data.tokenExp - Date.now();
      const timer = setTimeout(() => socket.disconnect(true), Math.max(0, Math.min(left, 2 ** 31 - 1)));
      timer.unref?.();
      socket.data.expTimer = timer;
    }

    log.info("socket.connected", { id_user, sid: socket.id });

    // Só participante escuta a conversa. Antes qualquer logado entrava na sala
    // com o id na mão e recebia as mensagens dos outros em tempo real.
    socket.on("conversation:subscribe", async (payload) => {
      const id = payload?.id_conversation;
      if (typeof id !== "string" || !UUID_RE.test(id)) return;
      try {
        const pool = require("../databases");
        const ConversationStorage = require("../storages/ConversationStorage");
        const allowed = await ConversationStorage.userCanAccessConversation(pool, {
          id_conversation: id,
          id_user,
        });
        if (!allowed) return;
        socket.join(conversationRoom(id));
        socket.data.convRooms.add(id);
      } catch (err) {
        log.warn("conversation.subscribe_fail", { id_conversation: id, message: err?.message });
      }
    });

    socket.on("conversation:unsubscribe", (payload) => {
      const id = payload?.id_conversation;
      if (typeof id === "string" && id.length > 0) {
        socket.leave(conversationRoom(id));
        socket.data.convRooms?.delete(id);
      }
    });

    socket.on("chat:subscribe", async (payload) => {
      const id = payload?.id_chat_room;
      if (typeof id !== "string" || !UUID_RE.test(id)) return;
      try {
        // A mesma régua do REST: sala ativa e, para menor, liberada.
        const ChatService = require("../services/ChatService");
        if (!(await ChatService.canSubscribe(id_user, id))) return;
        socket.join(chatRoom(id));
        socket.data.chatRooms.add(id);
        const online = await touchChatPresence(id, id_user);
        io.to(chatRoom(id)).emit("chat:presence", { id_chat_room: id, current_users: online });
      } catch (err) {
        log.warn("chat_presence.subscribe_fail", { id_chat_room: id, message: err?.message });
      }
    });

    socket.on("chat:unsubscribe", async (payload) => {
      const id = payload?.id_chat_room;
      if (typeof id !== "string" || !UUID_RE.test(id)) return;
      socket.leave(chatRoom(id));
      socket.data.chatRooms.delete(id);
      try {
        const online = await dropChatPresence(id, id_user);
        io.to(chatRoom(id)).emit("chat:presence", { id_chat_room: id, current_users: online });
      } catch (err) {
        log.warn("chat_presence.unsubscribe_fail", { id_chat_room: id, message: err?.message });
      }
    });

    // Clusters de Live: só membro do cluster (ou Administrator) entra na sala.
    socket.on("cluster:subscribe", async (payload) => {
      const id = payload?.id_live_cluster;
      if (typeof id !== "string" || !UUID_RE.test(id)) return;
      try {
        const pool = require("../databases");
        const LiveClusterStorage = require("../storages/LiveClusterStorage");
        const allowed = await LiveClusterStorage.canAccessCluster(pool, {
          id_live_cluster: id,
          id_user,
        });
        if (!allowed) return;
        socket.join(clusterRoom(id));
        socket.data.clusterRooms.add(id);
        await emitClusterPresence(id);
      } catch (err) {
        log.warn("cluster.subscribe_fail", { id_live_cluster: id, message: err?.message });
      }
    });

    socket.on("cluster:unsubscribe", async (payload) => {
      const id = payload?.id_live_cluster;
      if (typeof id !== "string" || !UUID_RE.test(id)) return;
      socket.leave(clusterRoom(id));
      socket.data.clusterRooms.delete(id);
      await emitClusterPresence(id);
    });

    socket.on("disconnect", (reason) => {
      if (socket.data.expTimer) clearTimeout(socket.data.expTimer);
      log.info("socket.disconnected", { id_user, sid: socket.id, reason });
      // Fechou aba/navegou: some da presença das salas de chat (as rooms do
      // socket.io o adapter já limpa sozinho).
      for (const id of socket.data.chatRooms || []) {
        dropChatPresence(id, id_user)
          .then((online) => {
            io.to(chatRoom(id)).emit("chat:presence", { id_chat_room: id, current_users: online });
          })
          .catch(() => {});
      }
      for (const id of socket.data.clusterRooms || []) {
        emitClusterPresence(id).catch(() => {});
      }
    });
  });

  if (!presenceSweepTimer) {
    presenceSweepTimer = setInterval(sweepChatPresence, PRESENCE_SWEEP_MS);
    presenceSweepTimer.unref?.();
  }
  if (!revalidateTimer) {
    revalidateTimer = setInterval(() => {
      revalidateAll().catch((err) => log.warn("revalidate.fail", { message: err?.message }));
    }, REVALIDATE_MS);
    revalidateTimer.unref?.();
  }

  log.info("realtime.initialized", { path: "/realtime" });
  return io;
}

async function accountUsable(id_user) {
  const pool = require("../databases");
  const r = await pool.query(`SELECT ativo, blocked_at FROM public.tb_user WHERE id_user = $1`, [id_user]);
  const row = r.rows[0];
  return !!(row && row.ativo && !row.blocked_at);
}

/** Uma passada: conta ainda usável? salas ainda permitidas? */
async function revalidateSocket(socket) {
  const id_user = socket.data?.id_user;
  if (!id_user) return;
  if (!(await accountUsable(id_user))) {
    socket.disconnect(true);
    return;
  }
  const pool = require("../databases");
  const ConversationStorage = require("../storages/ConversationStorage");
  for (const id of [...(socket.data.convRooms || [])]) {
    const ok = await ConversationStorage.userCanAccessConversation(pool, { id_conversation: id, id_user });
    if (!ok) {
      socket.leave(conversationRoom(id));
      socket.data.convRooms.delete(id);
    }
  }
  const ChatService = require("../services/ChatService");
  for (const id of [...(socket.data.chatRooms || [])]) {
    if (!(await ChatService.canSubscribe(id_user, id))) {
      socket.leave(chatRoom(id));
      socket.data.chatRooms.delete(id);
    }
  }
}

async function revalidateAll() {
  if (!io) return;
  const sockets = await io.fetchSockets();
  for (const s of sockets) {
    // fetchSockets devolve uma visão remota; o socket local tem os dados.
    const local = io.sockets.sockets.get(s.id);
    if (local) await revalidateSocket(local).catch(() => {});
  }
}

/**
 * Permissão de uma conversa mudou (saiu do grupo, conversa apagada): quem
 * ainda está na sala é reconferido NA HORA, sem esperar a passada periódica.
 */
async function revalidateConversation(id_conversation) {
  if (!io || !id_conversation) return;
  const pool = require("../databases");
  const ConversationStorage = require("../storages/ConversationStorage");
  const sockets = await io.in(conversationRoom(id_conversation)).fetchSockets();
  for (const s of sockets) {
    const local = io.sockets.sockets.get(s.id);
    if (!local) continue;
    const ok = await ConversationStorage.userCanAccessConversation(pool, {
      id_conversation,
      id_user: local.data?.id_user,
    });
    if (!ok) {
      local.leave(conversationRoom(id_conversation));
      local.data.convRooms?.delete(id_conversation);
    }
  }
}

/** Conta sancionada agora: derruba todos os sockets dela. */
function disconnectUser(id_user) {
  if (!io || !id_user) return;
  io.in(userRoom(id_user)).disconnectSockets(true);
}

function emitToUser(id_user, event, payload) {
  if (!io || !id_user) return;
  try {
    io.to(userRoom(id_user)).emit(event, payload);
  } catch (err) {
    log.error("emit.user_error", { message: err?.message, event });
  }
}

function emitToConversation(id_conversation, event, payload) {
  if (!io || !id_conversation) return;
  try {
    io.to(conversationRoom(id_conversation)).emit(event, payload);
  } catch (err) {
    log.error("emit.conversation_error", { message: err?.message, event });
  }
}

function emitToClusterRoom(id_live_cluster, event, payload) {
  if (!io || !id_live_cluster) return;
  try {
    io.to(clusterRoom(id_live_cluster)).emit(event, payload);
  } catch (err) {
    log.error("emit.cluster_room_error", { message: err?.message, event });
  }
}

function emitToChatRoom(id_chat_room, event, payload) {
  if (!io || !id_chat_room) return;
  try {
    io.to(chatRoom(id_chat_room)).emit(event, payload);
  } catch (err) {
    log.error("emit.chat_room_error", { message: err?.message, event });
  }
}

// Broadcast pra TODOS os sockets conectados (payloads pequenos — ex.: aviso
// de que a lista de lives mudou). Não usar pra dados por-usuário.
function emitToAll(event, payload) {
  if (!io) return;
  try {
    io.emit(event, payload);
  } catch (err) {
    log.error("emit.all_error", { message: err?.message, event });
  }
}

function getIo() {
  return io;
}

module.exports = {
  init,
  originAllowed,
  revalidateConversation,
  revalidateAll,
  disconnectUser,
  emitToUser,
  emitToConversation,
  emitToChatRoom,
  emitToClusterRoom,
  emitToAll,
  getIo,
};
