// Portão da sala do jogo no chat ao vivo (mm3d-32): o Global do Meu Mundo é uma
// sala de tb_chat_room, mas só o MeuMundoChatService passa por ela (opts.game).
// Pelas rotas do site (listMessages/sendMessage com 3 argumentos) e pelo socket
// ela não existe — senão qualquer um leria e postaria sem o filtro de bloqueio.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const SRC = path.join(__dirname, "..", "..", "src");
const stub = (rel, exports) => {
  const file = require.resolve(path.join(SRC, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const room = { id_chat_room: ROOM_ID, type: "meu_mundo", status: "active", id_machine: null };
const calls = { list: 0, emit: 0 };

stub("databases", { query: async () => ({ rows: [] }) });
stub("storages/ChatStorage", {
  getRoomById: async (_c, id) => (id === ROOM_ID ? room : null),
  upsertPresence: async () => {},
  countOnline: async () => 0,
  listMessages: async () => {
    calls.list += 1;
    return [];
  },
});
stub("storages/ChatReadStorage", { markRead: async () => {} });
stub("services/ChatModerationService", {
  moderateMessage: async () => ({ action: "block", user_facing_error: "bloqueada" }),
  applyResult: async () => {},
});
stub("realtime/socket", {
  emitToChatRoom: () => {
    calls.emit += 1;
  },
});
stub("utils/supervision", {
  assertMinorPermission: async () => null,
  assertMachineAllowed: async () => null,
});

const ChatService = require(path.join(SRC, "services", "ChatService.js"));
const user = { id_user: "u1" };

test("listMessages do site (sem opts) não enxerga a sala do jogo", async () => {
  const before = calls.list;
  const r = await ChatService.listMessages(user, { id_chat_room: ROOM_ID }, {});
  assert.equal(r.statusCode, 404);
  assert.equal(calls.list, before, "não chegou a ler mensagens");
});

test("listMessages com { game: true } passa do portão", async () => {
  const before = calls.list;
  const r = await ChatService.listMessages(user, { id_chat_room: ROOM_ID }, {}, { game: true });
  assert.notEqual(r.statusCode, 404);
  assert.ok(!r.error, `não deveria dar erro: ${r.error}`);
  assert.equal(calls.list, before + 1);
});

test("sendMessage do site (sem opts) dá 404 e não modera nem grava", async () => {
  const r = await ChatService.sendMessage(user, { id_chat_room: ROOM_ID }, { content: "oi" });
  assert.equal(r.statusCode, 404);
});

test("sendMessage com { game: true } passa do portão (cai na moderação)", async () => {
  const r = await ChatService.sendMessage(user, { id_chat_room: ROOM_ID }, { content: "oi" }, { game: true, silent: true });
  assert.notEqual(r.statusCode, 404);
  assert.equal(r.moderation_action, "block");
  assert.equal(calls.emit, 0);
});

test("canSubscribe recusa a sala do jogo", async () => {
  assert.equal(await ChatService.canSubscribe("u1", ROOM_ID), false);
});
