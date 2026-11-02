// mm3d-59 — progressão de aventura: XP, orçamento diário, destreza, luta conferida.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const L = require("../../src/utils/meuMundoLife");
const A = require("../../src/utils/meuMundoAdventure");
const F = require("../../src/utils/meuMundoFight");
const { build, OUT } = require("../../scripts/build-fight-sim");

// 2026-11-02 15:00 em Brasília (UTC−3)
const NOON = Date.parse("2026-11-02T18:00:00Z");
const MIN = 60000;
const fresh = (seed = 5, t = NOON) => L.birth(seed, t);

test("luta gerada: src/utils/meuMundoFight.js em dia com o TS do front", () => {
  const cur = fs.readFileSync(OUT, "utf8").replace(/\r\n/g, "\n");
  assert.equal(cur, build(), "rode node scripts/build-fight-sim.js");
});

test("XP: curva e nível", () => {
  assert.equal(A.xpToNext(1), 100);
  assert.equal(A.xpToNext(2), 303);
  assert.deepEqual(A.levelOf(0), { level: 1, into: 0, need: 100, total: 0 });
  assert.equal(A.levelOf(99).level, 1);
  assert.equal(A.levelOf(100).level, 2);
  assert.equal(A.levelOf(403).level, 3, "o prólogo (≥ 420) garante o nível 3");
});

test("destreza: nasce pela semente (15–30), sem mudar o sorteio do resto", () => {
  const s = fresh(1234);
  assert.equal(s.dexterity, 15 + (1234 % 16));
  assert.equal(s.peaks.dexterity, s.dexterity);
  assert.ok(s.dexterity >= 15 && s.dexterity <= 30);
});

test("orçamento: 2 h de minijogo de destreza param em 12 pontos-base no dia", () => {
  const s = fresh();
  const r = A.practice(s, "paint", [{ from: NOON, to: NOON + 120 * MIN }]);
  // Paint tem janela de 12 min por partida → 1,2 base; muitas partidas é que batem o teto
  assert.ok(Math.abs(r.base.dexterity - 1.2) < 1e-9);
  for (let i = 1; i < 20; i++) A.practice(s, "paint", [{ from: NOON + i * 15 * MIN, to: NOON + i * 15 * MIN + 12 * MIN }]);
  assert.equal(L.budgetLeft(s, "dexterity", NOON), 0, "teto de 12 batido");
  const d0 = s.dexterity;
  A.practice(s, "gincana", [{ from: NOON + 6 * 3600000, to: NOON + 6 * 3600000 + 6 * MIN }]);
  assert.equal(s.dexterity, d0, "outro jogo do mesmo atributo não reinicia o teto");
});

test("orçamento: academia e minijogo dividem a mesma força", () => {
  const s = fresh();
  for (let i = 0; i < 8; i++) A.practice(s, "laminas", [{ from: NOON + i * 10 * MIN, to: NOON + i * 10 * MIN + 6 * MIN }]);
  const used = 12 - L.budgetLeft(s, "strength", NOON);
  assert.ok(Math.abs(used - 4.8) < 1e-6, `8 lutas de 6 min = 4,8 base (usou ${used})`);
  // a vida (academia) gasta do mesmo saldo
  const got = L.gain(s, "strength", 50, NOON);
  assert.ok(got > 0);
  assert.equal(L.budgetLeft(s, "strength", NOON), 0);
});

test("orçamento: partida que atravessa a meia-noite reparte entre os dois dias", () => {
  const s = fresh();
  const mid = Date.parse("2026-11-03T03:00:00Z"); // meia-noite em Brasília
  const parts = A.splitByDay([{ from: mid - 4 * MIN, to: mid + 2 * MIN }]);
  assert.deepEqual(parts.map((p) => [p.day, p.ms / MIN]), [["2026-11-02", 4], ["2026-11-03", 2]]);
  A.practice(s, "noturno", [{ from: mid - 4 * MIN, to: mid + 2 * MIN }]);
  assert.ok(Math.abs(12 - L.budgetLeft(s, "dexterity", mid - MIN) - 0.4) < 1e-9);
  assert.ok(Math.abs(12 - L.budgetLeft(s, "dexterity", mid + MIN) - 0.2) < 1e-9);
});

test("curva uma vez e memória só até o pico anterior", () => {
  const s = fresh();
  s.strength = 100;
  s.peaks.strength = 101;
  const got = L.gain(s, "strength", 4, NOON);
  const curve = Math.pow(1 - 100 / 1100, 2);
  // 1 ponto até o pico a ×2 (gasta 0,5 de base·curva), o resto a ×1
  const expect = 1 + (4 * curve - 0.5);
  assert.ok(Math.abs(got - expect) < 1e-9, `${got} vs ${expect}`);
});

test("custo da luta: delta efetivo e a 3ª derrota seguida sem estresse", () => {
  const s = fresh();
  s.energy = 3;
  s.stress = 10;
  assert.deepEqual(A.applyFightCost(s, false, 0), { energy: -3, stress: 5 });
  assert.deepEqual(A.applyFightCost(s, false, 2), { energy: 0, stress: 0 });
  assert.deepEqual(A.applyFightCost(s, true, 0, true), { energy: 0, stress: 0 }, "tutorial não cobra");
});

test("luta conferida: replay igual ao aparelho; gravação alterada perde", () => {
  const setup = { kind: "soldier", level: 1, seed: 99, stats: { strength: 150, speed: 150, intelligence: 80, dexterity: 40 } };
  const fight = new F.Fight(setup);
  const frames = [];
  for (let i = 0; i < 20000 && !fight.over; i++) {
    const q = F.quantizeInput({ mx: Math.sin(i / 40) * 0.6, mz: 0.8, run: false, attack: i % 18 === 0, dodge: i % 113 === 0 });
    F.pushFrame(frames, q);
    fight.step(q);
  }
  const r = F.replayFight(setup, JSON.parse(JSON.stringify(frames)));
  assert.equal(r.ok, true);
  assert.equal(r.win, fight.over.win);
  // sem ataque nenhum: não vence
  const idle = F.replayFight(setup, [[3000, 0, 0, 0]]);
  assert.equal(idle.win, false);
  assert.ok(idle.activeSteps < 3000 * 0.2, "parado não conta como ativo");
  assert.equal(F.replayFight(setup, [[1, 999, 0, 0]]).ok, false, "fora da faixa");
  assert.equal(F.replayFight(setup, [[60, 0, 0, 2]]).reason, "open", "luta sem fim não vale");
});

test("destreza: menos fôlego e ranque com 30% do peso", () => {
  const lo = F.statEffects({ strength: 300, speed: 300, intelligence: 300, dexterity: 0 });
  const hi = F.statEffects({ strength: 300, speed: 300, intelligence: 300, dexterity: 1000 });
  assert.equal(lo.stamK, 1);
  assert.ok(Math.abs(hi.stamK - 0.85) < 1e-9);
  assert.ok(Math.abs(hi.recoverK - 0.9) < 1e-9);
  const a = F.rankOdds(0, 0);
  const b = F.rankOdds(0, 1000);
  assert.ok(b[3] > a[3] && b[3] < F.rankOdds(1000, 0)[3], "destreza ajuda, menos que a inteligência");
});
