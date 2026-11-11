// test/unit/meuMundoDominiosLore.test.js — Domínios v2 DV6–DV9: Mar de Gelo, Fábrica de Bronze, Vulcão de
// Kragor e Cidade Orbital pela lore (historia/v2/04-mundo-exploravel.md §3–6), calibrados por robô, e os
// quatro deuses em fases (BOSSES em laminas/sim/fight.ts → meuMundoFight.js gerado).
const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../../src/utils/meuMundoFight");
const D = require("../../src/utils/meuMundoDomains");

const LORE = {
  gelo: ["peixe", "peixe", "caranguejo", "afogado", "afogado", "serpente", "ciborgue", "ciborgue", "ondina", "maru"],
  fabrica: ["rato", "rato", "aranha", "cobaia", "cobaia", "sucata", "garras", "garras", "esteira", "aeryn"],
  vulcao: ["salamandra", "salamandra", "mineiro", "mineiro", "touro", "lutador", "golem", "golem", "brutamontes", "kragor"],
  orbital: ["pomba", "pomba", "camaleao", "pintor", "pintor", "espelho", "cavaleiro", "cavaleiro", "arco", "iris"],
};
const GOD = { gelo: "maru", fabrica: "aeryn", vulcao: "kragor", orbital: "iris" };

test("DV6–DV9: as criaturas da lore por setor, regra de tipo que já existe e corpo que existe", () => {
  for (const [dom, ids] of Object.entries(LORE)) {
    assert.deepEqual(Array.from({ length: 10 }, (_, k) => D.foeOf(dom, k + 1).id), ids, dom);
    for (let s = 1; s <= 10; s++) {
      assert.ok(F.MOB_KINDS.includes(D.kindOf(dom, s)), `${dom} setor ${s}`);
      const f = D.foeOf(dom, s);
      if (f.body) assert.ok(F.BODY_SHEETS[f.body], `${dom} setor ${s}: corpo ${f.body}`);
    }
    const g = D.foeOf(dom, 10);
    assert.deepEqual(g, { id: GOD[dom], body: GOD[dom], rig: true, art: true }, `${dom}: o deus no corpo dele`);
    assert.equal(D.bossOf(dom, 10), GOD[dom]);
    assert.equal(D.bossOf(dom, 9), null, "só o setor 10 é chefão com fases");
  }
  // os elites que já existem no jogo
  assert.equal(D.kindOf("gelo", 7), "ciborgue");
  assert.equal(D.kindOf("fabrica", 7), "garras");
  assert.equal(D.kindOf("vulcao", 7), "stone");
  assert.equal(D.kindOf("vulcao", 9), "brute", "o Brutamontes é o porteiro do Castelo de Basalto");
  assert.equal(D.kindOf("orbital", 7), "cavaleiro");
  // Floresta e Cânion não mudaram
  assert.equal(D.foeOf("floresta", 10).id, "noctis");
  assert.equal(D.foeOf("canion", 10).id, "zephyra");
});

test("DV6–DV9: níveis calibrados com robô — sobem, nunca descem, e cada Domínio começa acima do fim do anterior − 4", () => {
  const order = ["canion", "gelo", "fabrica", "vulcao", "orbital"];
  for (let i = 1; i < order.length; i++) {
    const dom = order[i];
    const L = Array.from({ length: 10 }, (_, k) => D.sectorLevel(dom, k + 1));
    assert.deepEqual(L, [...D.LEVELS_BY_DOMAIN[dom]], dom);
    for (let s = 1; s < 10; s++) assert.ok(L[s] >= L[s - 1], `${dom} setor ${s + 1}`);
    assert.ok(L[0] >= D.sectorLevel(order[i - 1], 10) - 4, `${dom}: quem atravessou ${order[i - 1]} não volta lá embaixo`);
  }
});

test("DV6–DV9: os quatro deuses lutam em fases (66% e 33%), cada fase só acrescenta golpes", () => {
  for (const god of Object.values(GOD)) {
    assert.ok(F.BOSS_IDS.includes(god), god);
    const ph = F.BOSSES[god];
    assert.equal(ph.length, 2, god);
    assert.deepEqual(ph.map((p) => p.below), [0.66, 0.33], god);
    for (const p of ph) for (const a of p.add) assert.ok(a.id && a.dmg > 0 && a.windup > 0, `${god}: ${a.id}`);
    assert.equal(F.bossIdOf(god), god);
  }
});

test("DV6–DV9: as fases entram na luta (66% → fase 2 com 1 golpe novo, 33% → fase 3 com 2) e todo tiro é reto", () => {
  for (const [dom, god] of Object.entries(GOD)) {
    const f = new F.Fight({ kind: D.kindOf(dom, 10), level: D.sectorLevel(dom, 10), hero: D.heroOf(dom, 10), tier: "domain", seed: 777, stats: { strength: 150, speed: 150, intelligence: 150, dexterity: 150 }, body: null, boss: god });
    assert.equal(f.boss, god)
    const m = f.mobs[0];
    const n0 = m.attacks.length;
    m.hp = Math.round(m.hpMax * 0.6);
    f.events = [];
    assert.equal(f.bossPhase(m), true, god);
    assert.deepEqual(f.events, [{ t: "phase", id: m.id, phase: 2 }]);
    assert.equal(m.attacks.length, n0 + 1, god);
    for (const a of m.attacks.slice(n0)) if (a.line) assert.equal(a.arc, 0, `${god}: ${a.id} reto`);
    m.hp = Math.round(m.hpMax * 0.2);
    f.events = [];
    assert.equal(f.bossPhase(m), true, god);
    assert.equal(m.attacks.length, n0 + 3, god);
    assert.ok(m.restMul < 1 && m.speedMul > 1.2, god);
  }
});

test("DV6–DV9: robô — com o Poder recomendado vence bem mais o setor 1 do que o deus", () => {
  const C = require("../../scripts/mm-domain-calibrate");
  for (const dom of Object.keys(GOD)) {
    const at = (s) => C.winRate(D.kindOf(dom, s), D.sectorLevel(dom, s), D.recommendedPower(dom, s), D.heroOf(dom, s), 16, D.bossOf(dom, s));
    const first = at(1), last = at(10);
    assert.ok(first >= 0.75, `${dom} setor 1: ${first}`);
    assert.ok(last <= 0.8, `${dom} setor 10: ${last}`);
    assert.ok(first > last, dom);
  }
});
