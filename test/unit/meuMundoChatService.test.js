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

const w = { direct: [], profiles: {}, online: [1, 2, 3], blocks: [], pushed: [], said: [], sent: [], opened: [], history: [], rooms: new Map(), lookups: 0, gameMessages: new Set(), reported: [], listQuery: null };

stub("databases", { query: async () => ({ rows: [] }) });
stub("realtime/meuMundo.js", {
  pushChat: (u, line) => w.pushed.push([u, line]),
  sayInRoom: (u, text, canSee) => { w.said.push([u, text, [1, 2, 3].filter(canSee)]); return 1; },
  sessionOf: () => null,
  playerInMyRoom: (viewer, sid) => w.rooms.get(`${viewer}:${sid}`) || null,
  directInGame: (to, from, p) => { w.direct.push([to, from, p]); return true; },
});
stub("realtime/meuMundoPresence.js", { onlineUsers: () => w.online, get: (u) => (w.online.includes(u) ? { room: {} } : null) });
stub("storages/MeuMundoChatStorage.js", {
  ensureRoom: async () => ({ id_chat_room: "00000000-0000-4000-8000-000000000001", type: "meu_mundo" }),
  blockPairs: async (_c, u) => w.blocks.filter((p) => p.blocker_user_id === u || p.blocked_user_id === u),
  messageInRoom: async (_c, id) => w.gameMessages.has(id),
  accountProfileById: async (_c, pid) => {
    w.lookups++;
    return pid === P2 ? { id_profile: P2, id_user: 2 } : pid === P1 ? { id_profile: P1, id_user: 1 } : null;
  },
});
stub("storages/ProfileStorage.js", {
  getUserAccountProfileId: async (_c, u) => PROFILE_OF[u],
  getProfileById: async (_c, pid) => { w.lookups++; return w.profiles[pid] || null; },
});
stub("services/ChatService.js", {
  sendMessage: async (user, params, body, opts) => {
    w.sent.push({ user, params, body, opts });
    return { message: { id_chat_message: "m1", content: body.content, hidden: false, created_at: "t", sender: { id_user: user.id_user, username: "eu" }, profile: { id_profile: P1, display_name: "Eu", avatar_url: null } } };
  },
  listMessages: async (_u, _p, q) => { w.listQuery = q; return { items: w.history, next_before: null, has_more: false }; },
  reportMessage: async (_u, params) => { w.reported.push(params.id_chat_message); return w.reportResult || { ok: true }; },
});
stub("services/ConversationService.js", {
  openOrCreate: async (user, payload) => { w.opened.push({ user, payload }); return { conversation: { id_conversation: "c1" } }; },
});

const S = require("../../src/services/MeuMundoChatService");
const reset = () => Object.assign(w, { direct: [], profiles: {}, online: [1, 2, 3], blocks: [], pushed: [], said: [], sent: [], opened: [], history: [], lookups: 0, gameMessages: new Set(), reported: [], reportResult: null, listQuery: null });

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
  assert.equal(r.code, "block", "o front diferencia bloqueio/silêncio/análise pelo code");
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

const M1 = "44444444-4444-4444-8444-444444444444";

test("denúncia: só mensagem do Global do jogo; fora dele é 404 sem chamar o ChatService", async () => {
  reset();
  const r = await S.report(1, M1, { reason: "x" });
  assert.equal(r.statusCode, 404);
  assert.equal(r.code, "gone");
  assert.deepEqual(w.reported, []);
  w.gameMessages.add(M1);
  assert.deepEqual(await S.report(1, M1, { reason: "x" }), { ok: true });
  assert.deepEqual(w.reported, [M1]);
});

test("denúncia: 'não encontrada' do ChatService vira 404", async () => {
  reset();
  w.gameMessages.add(M1);
  w.reportResult = { error: "Mensagem não encontrada" };
  const r = await S.report(1, M1, {});
  assert.equal(r.statusCode, 404);
});

test("histórico: cursor inválido é 400; válido passa adiante", async () => {
  reset();
  const bad = await S.history(1, { before: "ontem" });
  assert.equal(bad.statusCode, 400);
  assert.equal(w.listQuery, null, "não chegou ao ChatService");
  await S.history(1, { before: "2026-10-25T10:00:00.000Z" });
  assert.equal(w.listQuery.before, "2026-10-25T10:00:00.000Z");
  await S.history(1, {});
  assert.equal(w.listQuery.before, null);
});

// mm3d-33: 1:1 que chega para quem está no jogo — balão + aviso só para ele.
const ACC2 = { id_profile: P2, id_user: 2, is_user_account: true };
test("relayDirect: perfil-conta para perfil-conta jogando → só o destinatário, texto do balão", async () => {
  reset();
  w.profiles[P1] = { id_profile: P1, id_user: 1, is_user_account: true, display_name: "Alex" };
  const ok = await S.relayDirect({ fromUserId: 1, actorId: P1, to: ACC2, conversationId: "c1", body: `  oi   ${"x".repeat(200)}` });
  assert.equal(ok, true);
  assert.equal(w.direct.length, 1);
  const [to, from, p] = w.direct[0];
  assert.equal(to, 2);
  assert.equal(from, 1);
  assert.equal(p.conversationId, "c1");
  assert.equal(p.name, "Alex");
  assert.equal(p.text.length, 90, "corte do balão");
  assert.ok(p.text.startsWith("oi x"));
});

test("relayDirect: destinatário fora do jogo não custa banco; perfil que não é conta não vira balão", async () => {
  reset();
  w.online = [1];
  w.profiles[P1] = { id_profile: P1, id_user: 1, is_user_account: true, display_name: "Alex" };
  assert.equal(await S.relayDirect({ fromUserId: 1, actorId: P1, to: ACC2, conversationId: "c1", body: "oi" }), false);
  assert.equal(w.lookups, 0);
  w.online = [1, 2];
  assert.equal(await S.relayDirect({ fromUserId: 1, actorId: P1, to: { ...ACC2, is_user_account: false }, conversationId: "c1", body: "oi" }), false);
  w.profiles[P1].is_user_account = false;
  assert.equal(await S.relayDirect({ fromUserId: 1, actorId: P1, to: ACC2, conversationId: "c1", body: "oi" }), false, "remetente com perfil de negócio");
  w.profiles[P1] = { id_profile: P1, id_user: 3, is_user_account: true };
  assert.equal(await S.relayDirect({ fromUserId: 1, actorId: P1, to: ACC2, conversationId: "c1", body: "oi" }), false, "perfil de outra pessoa");
  assert.equal(await S.relayDirect({ fromUserId: 2, actorId: P2, to: ACC2, conversationId: "c1", body: "oi" }), false, "consigo mesmo");
  assert.equal(w.direct.length, 0);
});
