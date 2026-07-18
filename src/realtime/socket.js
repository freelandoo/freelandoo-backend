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
      origin: (origin, callback) => callback(null, true),
      methods: ["GET", "POST"],
      credentials: true,
    },
    pingInterval: 25_000,
    pingTimeout: 60_000,
    maxHttpBufferSize: 1e6,
    transports: ["websocket", "polling"],
  });

  io.use((socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.query?.token ||
      (socket.handshake.headers?.authorization || "").split(" ")[1];
    if (!token) return next(new Error("missing_token"));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = { id_user: decoded.id_user, email: decoded.email };
      return next();
    } catch {
      return next(new Error("invalid_token"));
    }
  });

  io.on("connection", (socket) => {
    const id_user = socket.user?.id_user;
    if (!id_user) return socket.disconnect(true);
    socket.join(userRoom(id_user));
    socket.data.id_user = id_user;
    socket.data.chatRooms = new Set();
    socket.data.clusterRooms = new Set();

    log.info("socket.connected", { id_user, sid: socket.id });

    socket.on("conversation:subscribe", (payload) => {
      const id = payload?.id_conversation;
      if (typeof id === "string" && id.length > 0) {
        socket.join(conversationRoom(id));
      }
    });

    socket.on("conversation:unsubscribe", (payload) => {
      const id = payload?.id_conversation;
      if (typeof id === "string" && id.length > 0) {
        socket.leave(conversationRoom(id));
      }
    });

    socket.on("chat:subscribe", async (payload) => {
      const id = payload?.id_chat_room;
      if (typeof id !== "string" || !UUID_RE.test(id)) return;
      socket.join(chatRoom(id));
      socket.data.chatRooms.add(id);
      try {
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

  log.info("realtime.initialized", { path: "/realtime" });
  return io;
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
  emitToUser,
  emitToConversation,
  emitToChatRoom,
  emitToClusterRoom,
  emitToAll,
  getIo,
};
