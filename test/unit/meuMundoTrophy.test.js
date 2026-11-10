// B5 (2026-11-08): que luta entra no inventário de monstros e com que nome.
const test = require("node:test");
const assert = require("node:assert/strict");
const Adv = require("../../src/utils/meuMundoAdventure");

test("Arena e rua contam; Boxe e prólogo não", () => {
  assert.equal(Adv.trophyKind("laminas", "wolf"), "wolf");
  assert.equal(Adv.trophyKind("mob", "brute"), "brute");
  assert.equal(Adv.trophyKind("boxe", "wolf"), null);
  assert.equal(Adv.trophyKind("tutorial", "cavaleiro"), null);
});

test("F1: Golem de Pedra e Cavaleiro Dourado são tipos separados, na Arena e na rua", () => {
  assert.equal(Adv.trophyKind("mob", "stone"), "stone");
  assert.equal(Adv.trophyKind("laminas", "stone"), "stone");
  assert.equal(Adv.trophyKind("laminas", "cavaleiro"), "cavaleiro");
  // os ids antigos não são mais tipo de troféu (viraram os novos na mig 436)
  assert.equal(Adv.trophyKind("laminas", "soldier"), null);
});

test("monstro desconhecido não entra", () => {
  assert.equal(Adv.trophyKind("laminas", "dragao"), null);
  assert.deepEqual([...Adv.TROPHY_KINDS].sort(), ["brute", "cavaleiro", "ciborgue", "garras", "stone", "wolf"]);
});
