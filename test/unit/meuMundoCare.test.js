// O que sobe na tela ao comer, tomar remédio e acordar (2026-11-03).
const test = require("node:test");
const assert = require("node:assert/strict");
const Life = require("../../src/utils/meuMundoLife");
const { rowToState } = require("../../src/storages/MeuMundoLifeStorage");

const T0 = Date.UTC(2026, 10, 3, 15);
const H = 3600000;
const fresh = () => {
  const s = Life.birth(7, T0);
  Object.assign(s, { satiety: 40, energy: 50, stress: 50, health: 60, vitality: 100 });
  return s;
};

test("comer devolve o que mudou de verdade, não o número cheio do item", () => {
  const s = fresh();
  s.satiety = 80;
  const r = Life.consume(s, "prato_feito", T0);
  assert.ok(r.ok);
  assert.equal(r.felt.satiety, 20, "enche só até 100");
  assert.equal(r.felt.mood, 7);
});

test("remédio: calmante tira estresse e energia", () => {
  const r = Life.consume(fresh(), "calmante", T0);
  assert.equal(r.felt.stress, -30);
  assert.equal(r.felt.energy, -10);
});

test("admin (estresse 0, energia 100) vê o número do item", () => {
  const s = Life.adminTopUp(fresh());
  const r = Life.consume(s, "calmante", T0);
  assert.equal(r.felt.stress, -30);
  assert.equal(r.felt.energy, -10);
});

test("acordar guarda o estresse que saiu, mesmo dormindo entre duas leituras", () => {
  const night = Date.UTC(2026, 10, 4, 2); // 23 h em Brasília
  const s = Life.birth(7, night);
  Object.assign(s, { satiety: 80, energy: 50, stress: 50, health: 80, vitality: 100 });
  assert.ok(Life.startActivity(s, "sleeping", 8, night, { id: "b" }).ok);
  Life.noteSleep(s, night);
  Life.simulate(s, night + 9 * H, { coins: 0 }, {});
  assert.equal(s.activity.kind, "idle");
  assert.equal(s.sleepFrom, undefined);
  assert.ok(s.woke.stress < -5, `estresse ${s.woke.stress}`);
  assert.ok(s.woke.energy > 10, `energia ${s.woke.energy}`);
});

test("levantar logo depois de deitar não conta", () => {
  const s = fresh();
  Life.startActivity(s, "sleeping", 8, T0, { id: "b" });
  Life.noteSleep(s, T0);
  Life.startActivity(s, "idle", null, T0 + 60000);
  Life.noteSleep(s, T0 + 60000);
  assert.equal(s.woke, undefined);
});

test("admin ao acordar vê o que o sono renderia", () => {
  const s = Life.adminTopUp(fresh());
  Life.startActivity(s, "sleeping", 8, T0, { id: "b" });
  Life.noteSleep(s, T0);
  s.activity = { kind: "idle", startedAt: T0 + 8 * H, until: null, bed: null, resume: null };
  Life.noteSleep(s, T0 + 8 * H);
  assert.equal(s.woke.stress, -28);
});

test("o sono pendente volta do banco", () => {
  const s = rowToState({ sleep_note: { from: { at: 5, stress: 1, energy: 2 }, woke: null }, meals: {}, day_acc: {} });
  assert.deepEqual(s.sleepFrom, { at: 5, stress: 1, energy: 2 });
  assert.equal(s.woke, undefined);
});
