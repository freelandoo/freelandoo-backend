// B8 (2026-11-08): cadeiras do Hall — ficha congelada e o que muda na vitória.
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../../src/utils/meuMundoHallLadder");

test("peer = Poder do defensor ÷ o meu, entre 0,5 e 2", () => {
  assert.equal(L.peerOf(1000, 1500), 1.5);
  assert.equal(L.peerOf(1000, 9000), 2);
  assert.equal(L.peerOf(1000, 100), 0.5);
  assert.equal(L.peerOf(0, 0), 1);
});

test("vencer quem está sentado: troca de cadeira", () => {
  const s = new Map([[1, "a"], [2, "b"], [5, "me"]]);
  const r = L.afterWin(s, "me", "b");
  assert.equal(r.seatWon, 2);
  assert.equal(r.seats.get(2), "me");
  assert.equal(r.seats.get(5), "b");
});

test("de fora do Hall e vence quem está sentado: o defensor sai", () => {
  const r = L.afterWin(new Map([[1, "a"]]), "me", "a");
  assert.equal(r.seatWon, 1);
  assert.deepEqual([...r.seats.values()], ["me"]);
});

test("já acima do defensor: venceu, o Hall fica", () => {
  const s = new Map([[1, "me"], [3, "b"]]);
  const r = L.afterWin(s, "me", "b");
  assert.equal(r.seatWon, null);
  assert.equal(r.seats.get(1), "me");
});

test("vencer alguém do top do Poder fora do Hall: senta na primeira vaga", () => {
  const r = L.afterWin(new Map([[1, "a"], [2, "b"]]), "me", "x");
  assert.equal(r.seatWon, 3);
  const full = new Map(Array.from({ length: 10 }, (_, i) => [i + 1, "u" + i]));
  assert.equal(L.afterWin(full, "me", "x").seatWon, null);
});
