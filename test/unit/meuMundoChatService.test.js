// test/unit/meuMundoChatService.test.js — mm3d-32: o serviço do chat do jogo.
// Sala, banco, ChatService e ConversationService são dublês: o que se prova é
// a regra — bloqueio não recebe, não ganha balão e some do histórico; o 1:1
// sai do perfil-conta dos dois lados e nunca é consigo mesmo.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const SRC = path.join(__dirname, "..", "..", "src");
const stub = (rel, exports) => {
  const file = require.resolve(path.join(SRC, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};

// id_profile é UUID no banco: o serviço recusa o que não for UUID antes do SQL.
const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const PX = "99999999-9999-4999-8999-999999999999";
const PROFILE_OF = { 1: P1, 2: P2, 3: "33333333-3333-4333-8333-333333333333" };

const w = { online: [1, 2, 3], blocks: [], pushed: [], said: [], sent: [], opened: [], history: [], rooms: new Map(), lookups: 0 };

stub("databases", { query: async () => ({ rows: [] }) });
stub("realtime/meuMundo.js", {
  pushChat: (u, line) => w.pushed.push([u, line]),
  sayInRoom: (u, text, canSee) => { w.said.push([u, text, [1, 2, 3].filter(canSee)]); return 1; },
  sessionOf: () => null,
  playerInMyRoom: (viewer, sid) => w.rooms.get(`${viewer}:${sid}`) || null,
});
stub("realtime/meuMundoPresence.js", { onlineUsers: () => w.online });
stub("storages/MeuMundoChatStorage.js", {
  ensureRoom: async () => ({ id_chat_room: "00000000-0000-4000-8000-000000000001", type: "meu_mundo" }),
  blockPairs: async (_c, u) => w.blocks.filter((p) => p.blocker_user_id === u || p.blocked_user_id === u),
  accountProfileById: async (_c, pid) => {
    w.lookups++;
    return pid === P2 ? { id_profile: P2, id_user: 2 } : pid === P1 ? { id_profile: P1, id_user: 1 } : null;
  },
});
stub("storages/ProfileStorage.js", { getUserAccountProfileId: async (_c, u) => PROFILE_OF[u] });
stub("services/ChatService.js", {
  sendMessage: async (user, params, body, opts) => {
    w.sent.push({ user, params, body, opts });
    return { message: { id_chat_message: "m1", content: body.content, hidden: false, created_at: "t", sender: { id_user: user.id_user, username: "eu" }, profile: { id_profile: P1, display_name: "Eu", avatar_url: null } } };
  },
  listMessages: async () => ({ items: w.history, next_before: null, has_more: false }),
  reportMessage: async () => ({ ok: true }),
});
stub("services/ConversationService.js", {
  openOrCreate: async (user, payload) => { w.opened.push({ user, payload }); return { conversation: { id_conversation: "c1" } }; },
});

const S = require("../../src/services/MeuMundoChatService");
const reset = () => Object.assign(w, { blocks: [], pushed: [], said: [], sent: [], opened: [], history: [], lookups: 0 });

test("enviar: grava com o perfil-conta, silencioso, e entrega a todos online", async () => {
  reset();
  const r = await S.send(1, { text: "oi" });
  assert.equal(r.line.text, "oi");
  assert.equal(w.sent[0].opts.id_profile, P1);
  assert.equal(w.sent[0].opts.silent, true);
  assert.equal(w.sent[0].opts.game, true);
  assert.deepEqual(w.pushed.map((p) => p[0]).sort(), [1, 2, 3]);
  assert.equal(w.pushed.find((p) => p[0] === 1)[1].mine, true);
});

test("bloqueio nos dois sentidos: não recebe a linha nem o balão", async () => {
  reset();
  w.blocks = [{ blocker_user_id: 3, blocked_user_id: 1 }];
  await S.send(1, { text: "oi" });
  assert.deepEqual(w.pushed.map((p) => p[0]).sort(), [1, 2]);
  assert.deepEqual(w.said[0][2], [1, 2]);
});

test("moderação recusou: devolve o erro e não entrega nada", async () => {
  reset();
  const orig = require(path.join(SRC, "services/ChatService.js")).sendMessage;
  require(path.join(SRC, "services/ChatService.js")).sendMessage = async () => ({ error: "Mensagem bloqueada.", moderation_action: "block" });
  const r = await S.send(1, { text: "xxx" });
  require(path.join(SRC, "services/ChatService.js")).sendMessage = orig;
  assert.equal(r.error, "Mensagem bloqueada.");
  assert.equal(w.pushed.length, 0);
  assert.equal(w.said.length, 0);
});

test("histórico some com quem tem bloqueio comigo", async () => {
  reset();
  w.blocks = [{ blocker_user_id: 1, blocked_user_id: 2 }];
  w.history = [
    { id_chat_message: "a", content: "x", hidden: false, sender: { id_user: 2 }, profile: null },
    { id_chat_message: "b", content: "y", hidden: false, sender: { id_user: 3 }, profile: null },
  ];
  const r = await S.history(1, {});
  assert.deepEqual(r.items.map((l) => l.id), ["b"]);
});

test("abrir 1:1 pela sessão: perfil-conta dos dois lados", async () => {
  reset();
  w.rooms.set("1:sessB", { userId: 2, name: "Bia" });
  const r = await S.openDirect(1, { session: "sessB" });
  assert.equal(r.conversation.id_conversation, "c1");
  assert.deepEqual(w.opened[0].payload, { actor_id: P1, actor_type: "profile", target_id: P2, target_type: "profile" });
});

test("abrir 1:1 pelo profileId da linha do Global; consigo mesmo não", async () => {
  reset();
  assert.equal((await S.openDirect(1, { profileId: P2 })).conversation.id_conversation, "c1");
  assert.equal((await S.openDirect(1, { profileId: P1 })).code, "self");
  assert.equal((await S.openDirect(1, { profileId: PX })).statusCode, 404);
});

test("profileId que não é UUID é recusado antes de chegar ao banco", async () => {
  reset();
  const r = await S.openDirect(1, { profileId: "p2" });
  assert.equal(r.statusCode, 404);
  assert.equal(w.lookups, 0);
});
