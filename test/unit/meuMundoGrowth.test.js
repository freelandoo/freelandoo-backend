// Crescer (mm3d-58): o hóspede nasce jovem e vira adulto pela idade; treino
// na academia adianta e o anabolizante dobra o adiantamento. Virou adulto:
// +20% em cada atributo e saúde 100.
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../../src/utils/meuMundoLife");

const H = L.HOUR;
const T0 = Date.UTC(2026, 9, 20, 10, 0, 0);

test("nasce jovem, com zero dias de crescimento", () => {
  const s = L.birth(7, T0);
  assert.deepEqual(s.growth, { stage: "young", days: 0 });
  const snap = L.snapshot(s, T0);
  assert.equal(snap.growth.stage, "young");
  assert.equal(snap.growth.adultDays, L.GROWTH.ADULT_DAYS);
  assert.equal(snap.growth.pct, 0);
});

test("pelo tempo vira adulto: +20% em tudo, pico junto, saúde 100, evento uma vez", () => {
  const s = L.birth(7, T0);
  s.growth.days = L.GROWTH.ADULT_DAYS - 0.05; // ~1,2 h para virar
  s.health = 55;
  const before = { intelligence: s.intelligence, strength: s.strength, speed: s.speed };
  const { events } = L.simulate(s, T0 + 3 * H);
  const adult = events.filter((e) => e.kind === "adult");
  assert.equal(adult.length, 1);
  assert.equal(s.growth.stage, "adult");
  assert.ok(s.health > 99, `saúde volta a 100 na virada: ${s.health}`);
  for (const k of ["intelligence", "strength", "speed"]) {
    // A virada aplica 1,2× e o resto do intervalo ainda pode mexer de leve.
    assert.ok(Math.abs(adult[0].data.after[k] - before[k] * 1.2) < 0.5, `${k}: ${adult[0].data.after[k]} vs ${before[k] * 1.2}`);
    assert.ok(s.peaks[k] >= adult[0].data.after[k] - 0.01); // evento vai com 2 casas
  }
  const again = L.simulate(s, T0 + 30 * 24 * H).events.filter((e) => e.kind === "adult");
  assert.equal(again.length, 0, "não vira adulto duas vezes");
  assert.equal(L.snapshot(s, T0 + 30 * 24 * H).growth.pct, 100);
});

test("academia adianta e anabolizante dobra o adiantamento", () => {
  const idle = L.birth(7, T0);
  const gym = L.birth(7, T0);
  const roid = L.birth(7, T0);
  L.consume(roid, "anabolizante", T0);
  assert.ok(L.startActivity(gym, "training", 4, T0, null, "academia").ok);
  assert.ok(L.startActivity(roid, "training", 4, T0, null, "academia").ok);
  for (const s of [idle, gym, roid]) L.simulate(s, T0 + 4 * H);
  const base = 4 / 24;
  assert.ok(Math.abs(idle.growth.days - base) < 1e-6, `parado: ${idle.growth.days}`);
  const extraGym = gym.growth.days - base;
  const extraRoid = roid.growth.days - base;
  assert.ok(extraGym > 5 && extraGym <= 4 * L.GROWTH.TRAIN_DAYS + 1e-6, `academia: +${extraGym}`);
  assert.ok(Math.abs(extraRoid - 2 * extraGym) < 1e-6, `anabolizante: +${extraRoid} vs 2×${extraGym}`);
});

test("hóspede de antes (sem growth) começa pelos dias de vida já gastos", () => {
  const s = L.birth(7, T0);
  delete s.growth;
  s.wearDays = 40;
  L.normalize(s);
  assert.deepEqual(s.growth, { stage: "young", days: 40 });
});
