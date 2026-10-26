// Entrega do chat pelas salas do jogo (mm3d-32): sessão só na mesma sala e
// balão só para os outros da sala que passam no filtro de bloqueio, com
// sessionId e texto — nunca id de conta (REDE.md). Presença real, salas falsas.

const test = require("node:test");
const assert = require("node:assert/strict");
const presence = require("../../src/realtime/meuMundoPresence");
const { sessionOf, sayInRoom, pushChat, directInGame } = require("../../src/realtime/meuMundoChatRelay");

function fakeRoom(players) {
  const room = { clients: [], sim: new Map() };
  for (const [sessionId, userId] of players) {
    const client = { sessionId, got: [], send(type, payload) { this.got.push([type, payload]); } };
    room.clients.push(client);
    room.sim.set(sessionId, { userId });
    if (userId) presence.claim(userId, room, sessionId, "center", "c1");
  }
  room.client = (sid) => room.clients.find((c) => c.sessionId === sid);
  return room;
}

test.beforeEach(() => presence._reset());

test("sessionOf: só devolve a sessão de quem está na MESMA sala", () => {
  const a = fakeRoom([["sA", "u1"], ["sB", "u2"]]);
  fakeRoom([["sC", "u3"]]);
  assert.equal(sessionOf("u1", "u2"), "sB");
  assert.equal(sessionOf("u1", "u3"), null, "outra sala");
  assert.equal(sessionOf("u1", "u9"), null, "fora do jogo");
  assert.equal(sessionOf("u9", "u1"), null, "quem lê está fora do jogo");
  assert.ok(a);
});

test("sayInRoom: não manda para quem falou, respeita canSee e ignora sim sem userId", () => {
  const room = fakeRoom([["sA", "u1"], ["sB", "u2"], ["sC", "u3"], ["sNPC", null]]);
  const other = fakeRoom([["sD", "u4"]]);
  const n = sayInRoom("u1", "oi", (u) => u !== "u3");
  assert.equal(n, 1);
  assert.deepEqual(room.client("sB").got, [["say", { s: "sA", t: "oi" }]]);
  assert.deepEqual(room.client("sA").got, [], "o próprio falante não recebe");
  assert.deepEqual(room.client("sC").got, [], "bloqueio não recebe");
  assert.deepEqual(room.client("sNPC").got, [], "sim sem userId é ignorado");
  assert.deepEqual(other.client("sD").got, [], "outra sala não recebe");
  assert.deepEqual(Object.keys(room.client("sB").got[0][1]).sort(), ["s", "t"], "payload só com sessão e texto");
});

test("sayInRoom: quem não está numa sala não fala (0)", () => {
  assert.equal(sayInRoom("u1", "oi", () => true), 0);
});

test("pushChat: entrega a linha só a quem está no jogo", () => {
  const room = fakeRoom([["sA", "u1"]]);
  assert.equal(pushChat("u1", { id: "m1" }), true);
  assert.deepEqual(room.client("sA").got, [["chat", { id: "m1" }]]);
  assert.equal(pushChat("u9", { id: "m1" }), false);
});

test("directInGame (mm3d-33): só o destinatário recebe; sessão de quem falou só na mesma sala", () => {
  const room = fakeRoom([["sA", "u1"], ["sB", "u2"], ["sC", "u3"]]);
  const other = fakeRoom([["sD", "u4"]]);
  assert.equal(directInGame("u2", "u1", { conversationId: "c1", name: "Alex", text: "oi" }), true);
  assert.deepEqual(room.client("sB").got, [["dm", { s: "sA", t: "oi", c: "c1", n: "Alex" }]]);
  assert.deepEqual(room.client("sA").got, [], "quem mandou não recebe");
  assert.deepEqual(room.client("sC").got, [], "terceiro da sala não vê");
  assert.equal(directInGame("u4", "u1", { conversationId: "c2", name: "Alex", text: "oi" }), true);
  assert.deepEqual(other.client("sD").got, [["dm", { s: null, t: "oi", c: "c2", n: "Alex" }]], "outra sala: só o aviso");
  assert.equal(directInGame("u9", "u1", { conversationId: "c3", name: "", text: "oi" }), false, "fora do jogo");
});
