// B5 (2026-11-08): que luta entra no inventário de monstros e com que nome.
const test = require("node:test");
const assert = require("node:assert/strict");
const Adv = require("../../src/utils/meuMundoAdventure");

test("Arena e rua contam; Boxe e prólogo não", () => {
  assert.equal(Adv.trophyKind("laminas", "wolf"), "wolf");
  assert.equal(Adv.trophyKind("mob", "brute"), "brute");
  assert.equal(Adv.trophyKind("boxe", "wolf"), null);
  assert.equal(Adv.trophyKind("tutorial", "soldier"), null);
});

test("na rua o soldier é o Golem de Pedra", () => {
  assert.equal(Adv.trophyKind("mob", "soldier"), "stone");
  assert.equal(Adv.trophyKind("laminas", "soldier"), "soldier");
});

test("monstro desconhecido não entra", () => {
  assert.equal(Adv.trophyKind("laminas", "dragao"), null);
  assert.deepEqual([...Adv.TROPHY_KINDS].sort(), ["brute", "golem", "harpy", "soldier", "stone", "wolf"]);
});
