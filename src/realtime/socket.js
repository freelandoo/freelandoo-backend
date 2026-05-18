const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { createLogger } = require("../utils/logger");

const log = createLogger("realtime");

let io = null;

const userRoom = (id_user) => `user:${id_user}`;
const conversationRoom = (id_conversation) => `conv:${id_conversation}`;

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

    socket.on("disconnect", (reason) => {
      log.info("socket.disconnected", { id_user, sid: socket.id, reason });
    });
  });

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

function getIo() {
  return io;
}

module.exports = {
  init,
  emitToUser,
  emitToConversation,
  getIo,
};
