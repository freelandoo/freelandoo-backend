// test/unit/meuMundoDominioCanion.test.js — lore v2 D5: o Cânion das Tempestades (domínio de
// Zéphyra, historia/v2/04-mundo-exploravel.md §2) pela lore, calibrado por robô, e Zéphyra em fases.
const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../../src/utils/meuMundoFight");
const D = require("../../src/utils/meuMundoDomains");
const P = require("../../src/utils/meuMundoPact");

const zephyra = (boss) => new F.Fight({ kind: "cavaleiro", level: 12, hero: 9, tier: "domain", seed: 777, stats: { strength: 150, speed: 150, intelligence: 150, dexterity: 150 }, body: null, boss });

test("D5: o Cânion pela lore — Abutres, Chacais, Mensageiros, Escorpião, Harpias (elite), A Carta (guardiã), Zéphyra (deusa)", () => {
  const ids = Array.from({ length: 10 }, (_, k) => D.foeOf("canion", k + 1).id);
  assert.deepEqual(ids, ["abutre", "abutre", "chacal", "mensageiro", "mensageiro", "escorpiao", "harpia", "harpia", "carta", "zephyra"]);
  // regra = tipo que já existe (luta antiga não muda)
  for (let s = 1; s <= 10; s++) assert.ok(F.MOB_KINDS.includes(D.kindOf("canion", s)), `setor ${s}`);
  assert.equal(D.kindOf("canion", 3), "wolf", "os Chacais andam em bando, como os lobos");
  assert.equal(D.kindOf("canion", 7), "garras", "as Harpias nasceram como o tipo harpy (hoje garras)");
  assert.equal(D.kindOf("canion", 10), "cavaleiro", "Zéphyra luta de espada, como a skin");
  const z = D.foeOf("canion", 10);
  assert.deepEqual(z, { id: "zephyra", body: "zephyra", rig: true, art: true });
  assert.equal(D.foeOf("canion", 4).body, "raposa_adulto", "Mensageiro = Raposa, de mão");
  assert.equal(D.foeOf("canion", 4).rig, false);
  for (let s = 1; s <= 10; s++) {
    const f = D.foeOf("canion", s);
    if (f.body) assert.ok(F.BODY_SHEETS[f.body], `setor ${s}: corpo ${f.body}`);
  }
  // a Floresta não mudou
  assert.equal(D.foeOf("floresta", 10).id, "noctis");
});

test("D5: níveis do Cânion calibrados com robô (sobem, nunca descem; acima da Floresta; a deusa no topo)", () => {
  const L = Array.from({ length: 10 }, (_, k) => D.sectorLevel("canion", k + 1));
  assert.deepEqual(L, [...D.LEVELS_BY_DOMAIN.canion]);
  for (let s = 1; s < 10; s++) assert.ok(L[s] >= L[s - 1], `setor ${s + 1}`);
  assert.ok(L[0] >= D.sectorLevel("floresta", 10) * 0.75, "quem atravessou a Floresta não volta lá embaixo");
  assert.equal(Math.max(...L), L[9]);
  const view = D.view(9, { floresta: 10 })[1];
  assert.equal(view.id, "canion");
  assert.equal(view.open, true);
  assert.equal(view.sectors[9].level, L[9]);
  assert.equal(view.sectors[9].foe.id, "zephyra");
});

test("S14: herói do robô = o do dia-alvo (Floresta 5 → 70 em 180 dias; Cânion 72 → 90 em 270)", () => {
  assert.deepEqual([D.heroOf("floresta", 1), D.heroOf("floresta", 10)], [5, 70]);
  assert.deepEqual([D.heroOf("canion", 1), D.heroOf("canion", 10)], [72, 90]);
  let prev = 0;
  for (const id of D.DOMAIN_IDS) for (let s = 1; s <= 10; s++) assert.ok(D.heroOf(id, s) >= prev, `${id} ${s}`), (prev = D.heroOf(id, s));
});

test("D5: só o setor 10 do Cânion tem chefão (Zéphyra); a tela manda", () => {
  assert.equal(D.bossOf("canion", 10), "zephyra");
  for (let s = 1; s < 10; s++) assert.equal(D.bossOf("canion", s), null);
  assert.equal(D.view(9, { floresta: 10 })[1].sectors[9].boss, "zephyra");
  assert.ok(F.BOSS_IDS.includes("zephyra"));
});

test("D5: fases de Zéphyra — 66% Vento que Derruba (rajada reta), 33% Rastro de Raio (avanço que arrasta + giro)", () => {
  const f = zephyra("zephyra");
  assert.equal(f.boss, "zephyra");
  const m = f.mobs[0];
  const n0 = m.attacks.length;
  m.hp = Math.round(m.hpMax * 0.6);
  f.events = [];
  assert.equal(f.bossPhase(m), true);
  assert.deepEqual(f.events, [{ t: "phase", id: m.id, phase: 2 }]);
  const gale = m.attacks.find((a) => a.id === "gale");
  assert.ok(gale && gale.line > 0 && gale.arc === 0, "todo tiro é reto");
  assert.equal(m.attacks.length, n0 + 1);
  m.hp = Math.round(m.hpMax * 0.2);
  f.events = [];
  assert.equal(f.bossPhase(m), true);
  assert.deepEqual(f.events, [{ t: "phase", id: m.id, phase: 3 }]);
  const rush = m.attacks.find((a) => a.id === "boltRush");
  assert.ok(rush && rush.ram && rush.lunge >= 10, "a luta é em movimento: avanço longo que arrasta");
  assert.ok(m.attacks.some((a) => a.id === "stormCut"));
  assert.ok(m.restMul < 1 && m.speedMul > 1.3);
});

test("D5: robô — com o Poder recomendado vence quase sempre o setor 1 e cerca de metade contra Zéphyra", () => {
  const W = require("../../scripts/mm-boss-wall");
  const at = (s) => W.sectorWinRate("canion", s, 24);
  const first = at(1);
  const last = at(10);
  assert.ok(first >= 0.8, `setor 1: ${first}`);
  assert.ok(last <= 0.7, `setor 10: ${last}`);
  assert.ok(first > last);
});

test("D5: o pacto de Zéphyra é na Antigravidade (corrida)", () => {
  assert.equal(P.GOD_GAME.zephyra, "corrida");
  assert.equal(D.domainOf("canion").god, "zephyra");
});
