// B10 (2026-11-08): aparelhos e cursos por nível — trava pelo atributo, rendimento e o saco.
const test = require("node:test");
const assert = require("node:assert/strict");
const Life = require("../../src/utils/meuMundoLife");

const H = 3600000;
const T0 = Date.UTC(2026, 10, 10, 13, 0, 0); // 10h em Brasília

function fresh(over = {}) {
  const s = Life.birth(42, T0)
  Object.assign(s, { energy: 90, stress: 10, satiety: 90, health: 90 }, over);
  return s;
}

test("parseStation e trava pelo atributo", () => {
  assert.deepEqual(Life.parseStation("weights:3"), { id: "weights", tier: 3 });
  assert.deepEqual(Life.parseStation("bag"), { id: "bag", tier: 1 });
  assert.equal(Life.parseStation("foguete:1"), null);
  const s = { strength: 200, speed: 40, intelligence: 600 };
  assert.equal(Life.stationBlock(s, "training", "academia", "weights:2"), null);
  assert.equal(Life.stationBlock(s, "training", "academia", "weights:3"), "tier");
  assert.equal(Life.stationBlock(s, "training", "academia", "treadmill:2"), "tier");
  assert.equal(Life.stationBlock(s, "training", "academia", "bag:2"), "station");
  assert.equal(Life.stationBlock(s, "studying", "universidade", "course:4"), null);
  assert.equal(Life.stationBlock(s, "studying", "escola", "book:3"), "station", "escola vai até o nível 2");
  assert.equal(Life.stationBlock(s, "studying", "academia", "course:1"), "station");
  assert.equal(Life.stationBlock(s, "training", "academia", null), null, "sem aparelho = treino de sempre");
});

function trainFor(station, over) {
  const s = fresh(over);
  const r = Life.startActivity(s, "training", 2, T0, null, "academia", station);
  assert.ok(r.ok, JSON.stringify(r));
  const before = { strength: s.strength, speed: s.speed, accuracy: s.accuracy || 0 };
  Life.simulate(s, T0 + 2 * H);
  return { strength: s.strength - before.strength, speed: s.speed - before.speed, accuracy: (s.accuracy || 0) - before.accuracy };
}

test("pesos treinam só força; nível mais alto rende mais por hora", () => {
  const lo = trainFor("weights:1", { strength: 520, speed: 100 });
  const hi = trainFor("weights:4", { strength: 520, speed: 100 });
  assert.ok(lo.strength > 0 && lo.speed === 0, JSON.stringify(lo));
  assert.ok(hi.strength > lo.strength * 1.3, JSON.stringify([lo, hi]));
});

test("esteira treina velocidade; saco treina velocidade e acurácia", () => {
  const run = trainFor("treadmill:1", { speed: 100 });
  assert.ok(run.speed > 0 && run.strength === 0, JSON.stringify(run));
  const bag = trainFor("bag", { speed: 100, accuracy: 0 });
  assert.ok(bag.accuracy > 0 && bag.speed > 0 && bag.strength === 0, JSON.stringify(bag));
});

test("sem aparelho: o treino de sempre (força e velocidade)", () => {
  const old = trainFor(null, { strength: 100, speed: 100 });
  assert.ok(old.strength > 0 && old.speed > 0 && old.accuracy === 0, JSON.stringify(old));
});

test("o orçamento do dia segue valendo no nível alto", () => {
  const s = fresh({ strength: 800 });
  assert.ok(Life.startActivity(s, "training", 12, T0, null, "academia", "weights:5").ok);
  Life.simulate(s, T0 + 12 * H);
  const day = Object.values(s.budget.days)[0];
  assert.ok(day.strength <= Life.ATTR.BUDGET.strength + 1e-9, JSON.stringify(day));
});
