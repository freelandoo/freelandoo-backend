// Crescer (mm3d-58; regra nova do Alex em 2026-11-02): o hóspede nasce jovem
// e vira adulto com 1 mês de idade E força +350 / inteligência +300 desde que
// nasceu (pelo pico). Virou adulto: +20% em cada atributo e saúde 100. A
// altura (meuMundoHeights.js): jovem 1,40 → 1,70/1,65 no 1º mês; adulto
// 1,80 → 2,40 no mês seguinte à virada.
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../../src/utils/meuMundoLife");
const { grownHeight, bodyStride, GROW } = require("../../src/utils/meuMundoHeights");

const H = L.HOUR;
const D = 24 * H;
const T0 = Date.UTC(2026, 9, 20, 10, 0, 0);

test("nasce jovem: idade conta do nascimento e a partida é marcada no 1º passo", () => {
  const s = L.birth(7, T0);
  assert.deepEqual(s.growth, { stage: "young", from: T0 });
  L.simulate(s, T0 + H);
  assert.ok(Math.abs(s.growth.base.strength - s.peaks.strength) < 1, "partida = o que tinha ao nascer")
  const snap = L.snapshot(s, T0 + H);
  assert.equal(snap.growth.stage, "young");
  assert.equal(snap.growth.minDays, 30);
  assert.deepEqual(snap.growth.target, { strength: 350, intelligence: 300 });
  assert.ok(snap.growth.pct < 1, `começa perto de zero: ${snap.growth.pct}`);
});

test("só o tempo não basta: com 60 dias e sem treino continua jovem", () => {
  const s = L.birth(7, T0);
  L.simulate(s, T0 + H);
  const { events } = L.simulate(s, T0 + 60 * D);
  assert.equal(events.filter((e) => e.kind === "adult").length, 0);
  assert.equal(s.growth.stage, "young");
});

test("força e inteligência no alvo mas antes de 1 mês: espera a idade", () => {
  const s = L.birth(7, T0);
  L.simulate(s, T0 + H);
  s.peaks.strength = s.growth.base.strength + 360;
  s.peaks.intelligence = s.growth.base.intelligence + 310;
  s.strength = s.peaks.strength;
  s.intelligence = s.peaks.intelligence;
  // (sem comer ele morreria em 20 dias simulados: a idade é que anda aqui)
  s.growth.from = T0 - 20 * D;
  L.simulate(s, T0 + 2 * H);
  assert.equal(s.growth.stage, "young", "20 dias: ainda jovem");
  s.growth.from = T0 - 30 * D + 3 * H; // faz 30 dias daqui a 1 h
  s.health = 55;
  const before = { intelligence: s.intelligence, strength: s.strength, speed: s.speed };
  const { events } = L.simulate(s, T0 + 5 * H);
  const adult = events.filter((e) => e.kind === "adult");
  assert.equal(adult.length, 1);
  assert.equal(s.growth.stage, "adult");
  assert.ok(s.growth.at >= T0 + 3 * H && s.growth.at <= T0 + 5 * H, "vira quando faz 30 dias");
  assert.ok(s.health > 99, `saúde 100 na virada: ${s.health}`);
  assert.ok(adult[0].data.after.speed > before.speed * 1.1, "+20% também na velocidade");
  assert.equal(L.simulate(s, T0 + 8 * H).events.filter((e) => e.kind === "adult").length, 0, "não vira duas vezes");
  assert.equal(L.snapshot(s, T0 + 8 * H).growth.pct, 100);
});

test("só força não basta: falta inteligência", () => {
  const s = L.birth(7, T0);
  L.simulate(s, T0 + H);
  s.peaks.strength = s.growth.base.strength + 400;
  s.strength = s.peaks.strength;
  s.growth.from = T0 - 45 * D;
  L.simulate(s, T0 + 2 * H);
  assert.equal(s.growth.stage, "young");
  const g = L.snapshot(s, T0 + 2 * H).growth;
  assert.ok(g.pct > 66 && g.pct < 100, `idade e força cheias, inteligência não: ${g.pct}`);
});

test("hóspede de antes: idade pelo nascimento e partida 25", () => {
  const s = L.birth(7, T0);
  s.growth = { stage: "young", days: 40 };
  s.bornAt = T0 - 40 * D;
  L.normalize(s);
  assert.equal(s.growth.from, T0 - 40 * D);
  assert.deepEqual(s.growth.base, { strength: Math.min(25, s.peaks.strength), intelligence: Math.min(25, s.peaks.intelligence) });
});

test("altura: jovem 1,40 → 1,70/1,65 em 1 mês; adulto 1,80 → 2,40 no mês seguinte", () => {
  const young = { stage: "young", from: T0 };
  assert.equal(grownHeight("raposa", young, T0), 1.4);
  assert.equal(grownHeight("raposa", young, T0 + 15 * D), 1.55);
  assert.equal(grownHeight("raposa", young, T0 + 30 * D), 1.7);
  assert.equal(grownHeight("vampira", young, T0 + 90 * D), 1.65);
  const adult = { stage: "adult", from: T0, at: new Date(T0 + 40 * D).toISOString() };
  assert.equal(grownHeight("raposa_adulta", adult, T0 + 40 * D), 1.8);
  assert.equal(grownHeight("vampiro_adulto", adult, T0 + 55 * D), 2.1);
  assert.equal(grownHeight("vampiro_adulto", adult, T0 + 400 * D), GROW.ADULT_TO);
  // quem não é de classe fica no tamanho do modelo
  assert.equal(grownHeight("golem", adult, T0), 4);
  assert.equal(grownHeight("normal", young, T0), 1.8);
  // passada pela altura de agora
  assert.equal(bodyStride("raposa_adulta", 1.8), 1);
  assert.ok(Math.abs(bodyStride("raposa_adulta", 2.4) - 2.4 / 1.8) < 1e-9);
});
