// Releitura do que acabou de ser gravado (mm3d-32): sendMessage relê a
// mensagem PELO ID inserido. Antes relia "a última da sala" (listMessages
// limit 1) — com duas pessoas enviando juntas, A recebia a mensagem de B (no
// Global do jogo isso entregava a linha de B filtrada pelos bloqueios de A e
// punha o texto de B no balão de A).

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const SRC = path.join(__dirname, "..", "..", "src");
const stub = (rel, exports) => {
  const file = require.resolve(path.join(SRC, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const MINE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const room = { id_chat_room: ROOM_ID, type: "global", status: "active", id_machine: null };
const calls = { enriched: [], list: 0, emitted: [] };

const row = (id, user, content) => ({
  id_chat_message: id, id_chat_room: ROOM_ID, id_user: user, id_profile: null, content,
  message_type: "text", created_at: new Date().toISOString(), deleted_at: null, hidden_at: null,
  user_username: user, user_nome: user,
});

stub("databases", { query: async () => ({ rows: [] }) });
stub("storages/ChatStorage", {
  getRoomById: async (_c, id) => (id === ROOM_ID ? room : null),
  getUserAnyProfile: async () => null,
  insertMessage: async (_c, m) => row(MINE, m.id_user, m.content),
  upsertPresence: async () => {},
  countOnline: async () => 0,
  getMessageEnriched: async (_c, id) => {
    calls.enriched.push(id);
    return id === MINE ? row(MINE, "u1", "a minha") : null;
  },
  // "A última da sala" é de outra pessoa, que gravou logo depois.
  listMessages: async () => {
    calls.list += 1;
    return [row("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "u2", "a do outro")];
  },
});
stub("storages/ChatReadStorage", { markRead: async () => {} });
stub("services/ChatModerationService", {
  moderateMessage: async () => ({ action: "allow" }),
  applyResult: async () => {},
});
stub("realtime/socket", { emitToChatRoom: (_r, _e, p) => calls.emitted.push(p.message) });
stub("utils/supervision", {
  assertMinorPermission: async () => null,
  assertMachineAllowed: async () => null,
});

const ChatService = require(path.join(SRC, "services", "ChatService.js"));

test("sendMessage relê pelo id inserido, nunca 'a última da sala'", async () => {
  const r = await ChatService.sendMessage({ id_user: "u1" }, { id_chat_room: ROOM_ID }, { content: "a minha" });
  assert.ok(!r.error, r.error);
  assert.deepEqual(calls.enriched, [MINE]);
  assert.equal(calls.list, 0, "não relê pela lista da sala");
  assert.equal(r.message.id_chat_message, MINE);
  assert.equal(r.message.content, "a minha");
  assert.equal(calls.emitted[0].id_chat_message, MINE, "o socket do site também leva a mensagem certa");
});
