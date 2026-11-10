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
  assert.ok(Math.abs(used - 3.2) < 1e-6, `8 lutas de 6 min, janela de 4 min = 3,2 base (usou ${used})`);
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
  assert.deepEqual(A.applyFightCost(s, false, 0), { energy: -3, stress: 6 });
  assert.deepEqual(A.applyFightCost(s, false, 2), { energy: 0, stress: 0 });
  assert.deepEqual(A.applyFightCost(s, true, 0, true), { energy: 0, stress: 0 }, "tutorial não cobra");
});

test("luta conferida: replay igual ao aparelho; gravação alterada perde", () => {
  const setup = { kind: "cavaleiro", level: 1, seed: 99, stats: { strength: 150, speed: 150, intelligence: 80, dexterity: 40 } };
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

// ── slice 3: equipamento ──
const Gear = require("../../src/utils/meuMundoGear");

test("equipamento: catálogo com ids únicos e os 151 itens da forja", () => {
  assert.equal(Gear.GEAR.length, 151);
  assert.equal(new Set(Gear.GEAR.map((g) => g.id)).size, 151);
  for (const g of Gear.GEAR) {
    assert.ok(Gear.CATEGORIES.includes(g.category), g.id);
    assert.ok(Gear.RARITIES.includes(g.rarity), g.id);
  }
  for (const r of Gear.RECIPES) for (const id of [r.out, ...Object.keys(r.needs)]) assert.ok(Gear.GEAR_BY_ID.has(id), `${r.id}: ${id}`);
});

test("equipamento: arma da classe, independente de skin; bônus somados com teto", () => {
  assert.equal(Gear.starterOf("vampiro"), "espada_aprendiz");
  assert.equal(Gear.starterOf("raposa"), "cajado_aprendiz");
  const staff = Gear.GEAR_BY_ID.get("cajado_eter");
  assert.equal(Gear.canEquip(staff, { clan: "vampiro", level: 9, owned: true }), "clan");
  assert.equal(Gear.canEquip(staff, { clan: "raposa", level: 1, owned: true }), "level");
  assert.equal(Gear.canEquip(staff, { clan: "raposa", level: 3, owned: true }), null);
  const b = Gear.gearBonus({ weapon: { id: "espada_eter", level: 5 }, armor: { id: "couraca_rebitada", level: 5 }, acc1: { id: "amuleto_aurion" }, acc2: { id: "luvas_precisao" } });
  assert.equal(b.dmg, 0.2, "preserva a soma 0,10 + 5×0,02 dentro do novo teto");
  assert.equal(b.def, 0.155, "proteção mantém o bônus anterior e o refinamento");
  assert.equal(b.power, 0.15);
});

test("drop: material comum garantido com participação; vitória aumenta; nunca vazio", () => {
  const never = () => 0.99;
  const always = () => 0;
  const loss = Gear.rollLoot("forja", { win: false, activeMs: 60000 }, never);
  assert.deepEqual(loss.map((d) => d.id), ["fragmento_lamina"]);
  const win = Gear.rollLoot("forja", { win: true, activeMs: 60000 }, always);
  assert.ok(win.find((d) => d.id === "fragmento_lamina").qty > loss[0].qty);
  assert.ok(win.some((d) => d.id === "nucleo_eter") && win.some((d) => d.id === "selo_forja"));
});

test("luta com equipamento: mais dano dado, menos levado, teto do lado da regra", () => {
  const base = new F.Fight({ kind: "ciborgue", seed: 3 });
  const geared = new F.Fight({ kind: "ciborgue", seed: 3, gear: { dmg: 0.5, def: 0.12 } });
  assert.ok(Math.abs(geared.fx.dmg / base.fx.dmg - 1.35) < 1e-9, "dano cortado no novo teto de +35%");
  assert.equal(geared.gear.def, 0.12);
});

// ── slice 4: medidor de prática das salas ──
const { PracticeMeter } = require("../../src/realtime/meuMundoPractice");

test("medidor: parado não conta, buraco fecha o trecho, entrega uma vez", () => {
  const m = new PracticeMeter("paint", "paint:t:1", null);
  const t0 = 1_000_000;
  for (let i = 0; i <= 100; i++) m.pose("u", { x: i * 0.1, z: 0 }, t0 + i * 50); // 5 s andando
  assert.equal(m.activeMs("u"), 5000);
  for (let i = 1; i <= 100; i++) m.pose("u", { x: 10, z: 0 }, t0 + 5000 + i * 50); // parado 5 s
  assert.equal(m.activeMs("u"), 5000, "parado não soma");
  m.pose("u", { x: 11, z: 0 }, t0 + 20000);
  m.pose("u", { x: 12, z: 0 }, t0 + 21000);
  assert.equal(m.activeMs("u"), 6000, "depois do buraco começa outro trecho");
  const calls = [];
  const Svc = require("../../src/services/MeuMundoAdventureService");
  const orig = Svc.creditMinigame;
  Svc.creditMinigame = async (id, o) => (calls.push([id, o.actionKey]), { receipt: null });
  try {
    m.settle("u");
    m.settle("u");
    m.settle();
  } finally {
    Svc.creditMinigame = orig;
  }
  assert.deepEqual(calls, [["u", "paint:t:1:u"]]);
});

test("mm3d-60b: vitória dá mais atributo que derrota; disposição (energia/estresse) pesa", () => {
  assert.equal(A.conditionFactor(100, 0), 1.3, "descansado e calmo");
  assert.equal(A.conditionFactor(0, 100), 0.3, "exausto e estressado");
  assert.ok(A.conditionFactor(80, 10) > A.conditionFactor(40, 60), "mais energia e menos estresse = mais");
  assert.ok(A.conditionFactor(60, 20) > A.conditionFactor(60, 70), "estresse sozinho já reduz");
  assert.ok(A.conditionFactor(90, 20) > A.conditionFactor(30, 20), "energia sozinha já reduz");
  const seg = [{ from: NOON, to: NOON + 4 * MIN }];
  const win = A.practice(fresh(), "laminas", seg, A.fightGainMult(true, 100, 0)).attrs.strength
  const loss = A.practice(fresh(), "laminas", seg, A.fightGainMult(false, 100, 0)).attrs.strength
  const tired = A.practice(fresh(), "laminas", seg, A.fightGainMult(true, 15, 85)).attrs.strength
  assert.ok(win > loss * 3, `vitória ${win} ≫ derrota ${loss}`)
  assert.ok(win > tired * 2.5, `descansado ${win} ≫ cansado ${tired}`)
  assert.ok(loss > 0, "derrota ainda dá um pouco")
});

test("mm3d-60b: custo — vitória cansa pouco e alivia; derrota cansa e estressa mais", () => {
  const s = fresh();
  s.energy = 80;
  s.stress = 30;
  assert.deepEqual(A.applyFightCost(s, true, 0), { energy: -4, stress: -3 });
  assert.deepEqual(A.applyFightCost(s, false, 0), { energy: -10, stress: 6 });
});

// ── mm3d-60k: drop de atributo da luta e moedas ──
function seq(seed) {
  let x = seed >>> 0
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}
const avgDrop = (o) => {
  const r = seq(7)
  let t = 0
  for (let i = 0; i < 6000; i++) t += Object.values(A.rollFightDrop(o, r)).reduce((a, b) => a + b, 0)
  return t / 6000
}
test("drop da luta: média 3 / 5 / 9 / 15 pela idade (vitória, saúde cheia, sem estresse)", () => {
  const base = { win: true, health: 100, vitality: 100, stress: 0 }
  assert.ok(Math.abs(avgDrop({ ...base, ageDays: 2, adult: false }) - 3) < 0.15)
  assert.ok(Math.abs(avgDrop({ ...base, ageDays: 8, adult: false }) - 5) < 0.2)
  assert.ok(Math.abs(avgDrop({ ...base, ageDays: 31, adult: false }) - 9) < 0.3)
  assert.ok(Math.abs(avgDrop({ ...base, ageDays: 0, adult: true }) - 15) < 0.4)
})
test("drop da luta: saúde baixa, estresse e derrota derrubam menos", () => {
  const full = avgDrop({ ageDays: 40, adult: true, win: true, health: 100, vitality: 100, stress: 0 })
  assert.ok(avgDrop({ ageDays: 40, adult: true, win: true, health: 40, vitality: 100, stress: 0 }) < full * 0.5)
  assert.ok(avgDrop({ ageDays: 40, adult: true, win: true, health: 100, vitality: 100, stress: 100 }) < full * 0.5)
  assert.ok(avgDrop({ ageDays: 40, adult: true, win: false, health: 100, vitality: 100, stress: 0 }) < full * 0.4)
  const o = A.rollFightDrop({ ageDays: 40, adult: true, win: true, health: 100, vitality: 100, stress: 0 }, seq(3))
  for (const [k, n] of Object.entries(o)) {
    assert.ok(["strength", "dexterity", "speed", "intelligence"].includes(k))
    assert.ok(Number.isInteger(n) && n > 0)
  }
})
test("moedas: luta e minijogo sempre dropam (vitória mais que derrota)", () => {
  const r = seq(11)
  assert.ok(A.fightCoins("cavaleiro", 1, true, r) >= 7)
  assert.ok(A.fightCoins("brute", 3, true, r) > A.fightCoins("cavaleiro", 1, true, r))
  assert.ok(A.fightCoins("wolf", 1, false, r) >= 2)
  assert.ok(A.minigameCoins(8 * 60000, false, r) >= 15)
  assert.equal(A.minigameCoins(0, true, r), 0)
})
