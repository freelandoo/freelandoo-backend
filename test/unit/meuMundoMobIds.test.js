// Lore v2, etapa F1 (2026-11-10): ids dos monstros — cavaleiro (Soldado de Pedra/Cavaleiro Dourado),
// stone (Golem de Pedra), ciborgue, garras — e a ponte para os ids antigos.
const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../../src/utils/meuMundoFight");
const Adv = require("../../src/utils/meuMundoAdventure");
const { KINDS } = require("../../src/realtime/meuMundoMobs");

const ids = (f) => f.mobs[0].attacks.map((a) => a.id);
const SK = ["skSlash", "skDash", "skShield", "skUlt"];

test("os seis tipos da luta, todos com definição, ficha e prêmio", () => {
  assert.deepEqual([...F.MOB_KINDS].sort(), ["brute", "cavaleiro", "ciborgue", "garras", "stone", "wolf"]);
  for (const k of F.MOB_KINDS) {
    assert.ok(F.MOBS[k], `MOBS.${k}`);
    assert.equal(F.MOB_SHEETS[k].length, 5, `MOB_SHEETS.${k}`);
    assert.ok(Adv.XP_GAIN.fightWin[k] > 0, `xp ${k}`);
    assert.ok(Adv.COINS.fightWin[k] > 0, `moedas ${k}`);
    assert.ok(Adv.TROPHY_KINDS.includes(k), `troféu ${k}`);
  }
});

test("o Cavaleiro luta de espada; o Golem de Pedra ficou com os socos, o salto e o raio", () => {
  assert.deepEqual(ids(new F.Fight({ kind: "cavaleiro", seed: 2, tier: "arena" })), ["cut", "thrust", ...SK]);
  assert.deepEqual(ids(new F.Fight({ kind: "stone", seed: 2, tier: "arena" })), ["jab", "hook", "leap", "zap", "max", ...SK]);
  assert.deepEqual(ids(new F.Fight({ kind: "stone", seed: 2, tier: "street" })), ["jab", "hook", "leap", "zap", "max", ...SK]);
  // o treino do prólogo e o ringue do Boxe seguem nos golpes de base, sem os poderes
  assert.deepEqual(ids(new F.Fight({ kind: "cavaleiro", seed: 2 })), ["cut", "thrust"]);
});

test("a ficha é a mesma na Arena e na rua para o Golem de Pedra", () => {
  const arena = new F.Fight({ kind: "stone", seed: 2, tier: "arena" }).mobs[0];
  const street = new F.Fight({ kind: "stone", level: 1, seed: 2, tier: "street" }).mobs[0];
  assert.equal(arena.hpMax, 175);
  assert.equal(street.hpMax, 175);
});

test("ids antigos: mobKindOf converte e a luta aberta antes da troca não quebra", () => {
  assert.equal(F.mobKindOf("soldier"), "cavaleiro");
  assert.equal(F.mobKindOf("golem"), "ciborgue");
  assert.equal(F.mobKindOf("harpy"), "garras");
  assert.equal(F.mobKindOf("stone"), "stone");
  assert.equal(F.mobKindOf("dragao"), null);
  assert.equal(F.mobKindOf(undefined), null);
  // o "soldier" da Arena e da rua era o Golem de Pedra; sem tier (treino, ringue) era o Soldado
  assert.equal(new F.Fight({ kind: "soldier", seed: 2, tier: "street" }).kind, "stone");
  assert.equal(new F.Fight({ kind: "soldier", seed: 2, tier: "arena" }).kind, "stone");
  assert.equal(new F.Fight({ kind: "soldier", seed: 2 }).kind, "cavaleiro");
  assert.equal(new F.Fight({ kind: "golem", seed: 2, tier: "arena" }).kind, "ciborgue");
  assert.equal(new F.Fight({ kind: "harpy", seed: 2, tier: "arena" }).kind, "garras");
});

test("na rua: Golem de Pedra, Ciborgue, Garras, lobos e Brutamontes; o Cavaleiro fica na Arena", () => {
  const street = KINDS.map(([k]) => k).sort();
  assert.deepEqual(street, ["brute", "ciborgue", "garras", "stone", "wolf"]);
  for (const k of street) assert.ok(F.MOB_KINDS.includes(k));
});
