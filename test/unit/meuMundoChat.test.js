// test/unit/meuMundoChat.test.js — MEU MUNDO 3D mm3d-32: regra pura do chat.
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../../src/utils/meuMundoChat");

// Entrada = a mensagem JÁ MAPEADA pelo ChatService (mapMessage, ChatService.js:65):
// { id_chat_message, content, hidden, created_at, sender: { id_user, username }, profile: { id_profile, display_name, avatar_url } | null }
const msg = (o = {}) => ({ id_chat_message: "m", content: "a", hidden: false, created_at: null, sender: { id_user: 1, username: null }, profile: null, ...o });

test("linha do Global: projeção campo a campo, sem id de usuário", () => {
  const line = C.toLine(
    msg({ id_chat_message: "m1", content: "oi", created_at: "2026-10-25T10:00:00Z", sender: { id_user: 7, username: "ana", nome: "Ana S" }, profile: { id_profile: "p7", display_name: "Ana", avatar_url: "a.png", xp_level: 3 } }),
    { viewerId: 9, sessionOf: () => "sessA" },
  );
  assert.deepEqual(line, { id: "m1", text: "oi", at: "2026-10-25T10:00:00Z", name: "Ana", avatar: "a.png", profileId: "p7", session: "sessA", mine: false });
  assert.equal(JSON.stringify(line).includes("\"7\""), false);
});

test("linha oculta pela moderação não sai", () => {
  assert.equal(C.toLine(msg({ hidden: true }), { viewerId: 2 }), null);
});

test("nome cai para @ e depois para 'Jogador'", () => {
  assert.equal(C.toLine(msg({ sender: { id_user: 1, username: "zé" } }), { viewerId: 2 }).name, "@zé");
  assert.equal(C.toLine(msg(), { viewerId: 2 }).name, "Jogador");
});

test("authorOf lê o id do remetente da mensagem mapeada", () => {
  assert.equal(C.authorOf(msg({ sender: { id_user: 42 } })), 42);
});

test("minha linha vem com mine=true e sem sessão", () => {
  const l = C.toLine(msg({ sender: { id_user: 5 } }), { viewerId: 5, sessionOf: () => "s" });
  assert.equal(l.mine, true);
  assert.equal(l.session, null);
});

test("quem recebe: online menos bloqueios nos dois sentidos, com o remetente", () => {
  const pairs = [{ blocker_user_id: 3, blocked_user_id: 1 }, { blocker_user_id: 1, blocked_user_id: 4 }];
  assert.deepEqual(C.recipients([1, 2, 3, 4, 5], 1, pairs).sort(), [1, 2, 5]);
});

test("balão: uma linha, 90 caracteres com reticências", () => {
  assert.equal(C.bubbleText("  oi\n\ntudo   bem  "), "oi tudo bem");
  const long = C.bubbleText("a".repeat(200));
  assert.equal(long.length, 90);
  assert.equal(long.endsWith("…"), true);
});
