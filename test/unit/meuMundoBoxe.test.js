// Arena de Boxe do Meu Mundo (mm3d-43). O jogador não controla a luta: os
// casos são o que ele sente — treino, comida, sono e saúde decidem; a luta é a
// mesma para a mesma semente (os aparelhos desenham a linha do tempo); a
// toalha encerra; e a luta volta para a vida (cansa, machuca, lesiona, leva ao
// hospital, paga a bolsa até o limite do dia, conta como treino).
const test = require("node:test");
const assert = require("node:assert/strict");
const B = require("../../src/utils/meuMundoBoxe");
const L = require("../../src/utils/meuMundoLife");

const T0 = Date.UTC(2026, 9, 28, 15, 0, 0);
const BASE = {
  strength: 300,
  speed: 300,
  intelligence: 200,
  leanKg: 60,
  fatPct: 14,
  energy: 85,
  satiety: 65,
  stress: 25,
  health: 92,
  awakeH: 4,
  endurance: 1,
  personality: { optimism: 0.5, anxiety: 0.5 },
};

function wins(a, b, n = 120) {
  let w = 0;
  for (let s = 1; s <= n; s++) if (B.simulate({ stats: a }, { stats: b }, s * 7919).result.winner === 0) w++;
  return w / n;
}

test("mesma semente, mesma luta; semente diferente, outra luta", () => {
  const a = B.simulate({ stats: BASE }, { stats: BASE }, 42);
  const b = B.simulate({ stats: BASE }, { stats: BASE }, 42);
  const c = B.simulate({ stats: BASE }, { stats: BASE }, 43);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.ev, c.ev);
});

test("linha do tempo coerente: ordem, sinos, fim, amostras dentro do ringue", () => {
  for (const seed of [1, 2, 3, 99, 1234]) {
    const f = B.simulate({ stats: BASE }, { stats: { ...BASE, strength: 500 } }, seed);
    for (let i = 1; i < f.ev.length; i++) assert.ok(f.ev[i][0] >= f.ev[i - 1][0] - 1e-9, "eventos em ordem");
    assert.equal(f.ev[0][2], B.EV.BELL);
    assert.equal(f.ev.at(-1)[2], B.EV.END);
    assert.equal(f.ev.at(-1)[1], f.result.winner);
    assert.ok(f.result.t <= B.BOXE.ROUNDS * B.BOXE.ROUND_S + (B.BOXE.ROUNDS - 1) * B.BOXE.BREAK_S + 60);
    assert.equal(f.smp[0].length, f.smp[1].length);
    const n = f.smp[0].length / 4;
    assert.ok(Math.abs(n - (f.result.t / f.sample + 1)) <= 2, "uma amostra a cada SAMPLE");
    for (const arr of f.smp) {
      for (let i = 0; i < arr.length; i += 4) {
        assert.ok(Math.abs(arr[i]) <= B.BOXE.RING + 1e-6 && Math.abs(arr[i + 1]) <= B.BOXE.RING + 1e-6, "dentro do ringue");
        assert.ok(arr[i + 2] >= 0 && arr[i + 2] <= 100 && arr[i + 3] >= 0 && arr[i + 3] <= 100, "barras 0–100");
      }
    }
    if (f.result.method === "points" || f.result.method === "draw") assert.equal(f.cards.length, B.BOXE.ROUNDS);
    assert.ok(JSON.stringify(f).length < 60000, "cabe numa mensagem");
  }
});

test("o treino decide: mais forte ou mais rápido ganha a maioria", () => {
  assert.ok(wins({ ...BASE, strength: 600 }, BASE) > 0.75);
  assert.ok(wins({ ...BASE, speed: 600 }, BASE) > 0.75);
  assert.ok(wins({ ...BASE, strength: 900, speed: 900 }, BASE) > 0.97);
  const even = wins(BASE, BASE);
  assert.ok(even > 0.3 && even < 0.7, `luta parelha é parelha (${even})`);
});

test("comida, sono e saúde pesam: com fome, cansado ou doente perde a maioria", () => {
  assert.ok(wins({ ...BASE, satiety: 10 }, BASE) < 0.2);
  assert.ok(wins({ ...BASE, energy: 18 }, BASE) < 0.2);
  assert.ok(wins({ ...BASE, health: 45 }, BASE) < 0.2);
  assert.ok(wins({ ...BASE, awakeH: 30 }, BASE) < 0.45);
  const f = B.fighter({ ...BASE, satiety: 10, energy: 18, awakeH: 30, stress: 80, health: 50 });
  for (const c of ["hungry", "exhausted", "sleepy", "stressed", "hurt"]) assert.ok(f.conditions.includes(c), c);
});

test("iniciantes quase nunca derrubam; o computador escala com o jogador", () => {
  const rookie = { ...BASE, strength: 25, speed: 25, intelligence: 20, leanKg: 50 };
  let kd = 0;
  for (let s = 1; s <= 60; s++) {
    const f = B.simulate({ stats: rookie }, { stats: rookie }, s);
    kd += f.stats[0].kd + f.stats[1].kd;
  }
  assert.ok(kd / 60 < 0.2);
  const easy = B.cpuStats(BASE, "easy", 5);
  const hard = B.cpuStats(BASE, "hard", 5);
  assert.ok(easy.strength < BASE.strength && hard.strength > BASE.strength);
  assert.ok(wins(BASE, easy) > 0.65);
  assert.ok(wins(BASE, hard) < 0.35);
});

test("toalha: quem joga perde ali, com o dano só até ali", () => {
  const f = B.simulate({ stats: BASE }, { stats: { ...BASE, strength: 700 } }, 77);
  const full = B.summary(f, 0);
  const cut = B.summary(f, 0, 40, 0);
  assert.equal(cut.outcome, "loss");
  assert.equal(cut.method, "towel");
  assert.ok(cut.taken <= full.taken);
  assert.ok(cut.activeS <= 40 && cut.activeS > 30);
  assert.equal(B.summary(f, 1, 40, 0).outcome, "win");
  // toalha depois do fim não muda nada
  assert.equal(B.summary(f, 0, 9999, 0).method, f.result.method);
});

test("vida: só luta quem está apto (energia, saúde, lesão, hospital, sono)", () => {
  const s = L.birth(7, T0);
  assert.equal(L.canFight(s, T0).ok, true);
  assert.equal(L.canFight({ ...s, energy: 10 }, T0).code, "tired");
  assert.equal(L.canFight({ ...s, health: 30 }, T0).code, "unfit");
  assert.equal(L.canFight({ ...s, activity: { kind: "hospital" } }, T0).code, "hospital");
  assert.equal(L.canFight({ ...s, activity: { kind: "sleeping" } }, T0).code, "sleeping");
  assert.equal(L.canFight({ ...s, effects: [{ id: "injury", until: T0 + 3600e3 }] }, T0).code, "injured");
});

test("vida: a luta cansa, gasta comida, machuca e conta como treino", () => {
  const s = L.birth(7, T0);
  const before = { energy: s.energy, satiety: s.satiety, health: s.health, strength: s.strength };
  const r = L.fightAftermath(s, { outcome: "loss", method: "points", taken: 80, kd: 0, activeS: 180, purse: 40 }, T0);
  assert.ok(r.ok);
  assert.ok(s.energy < before.energy - 20);
  assert.ok(s.satiety < before.satiety);
  assert.ok(s.health < before.health - 10);
  assert.ok(s.strength > before.strength, "luta é treino");
  assert.equal(r.coins, 0, "derrota não paga");
  assert.equal(r.hospital, false);
  assert.deepEqual(s.boxing, { w: 0, l: 1, d: 0, ko: 0 });
  assert.equal(L.snapshot(s, T0).boxing.l, 1);
});

test("vida: nocaute lesiona; nocaute feio leva ao hospital", () => {
  const s = L.birth(7, T0);
  const r = L.fightAftermath(s, { outcome: "loss", method: "ko", taken: 60, kd: 1, activeS: 100 }, T0);
  assert.equal(r.injuryH, L.BOXING.INJURY_H.ko);
  assert.equal(L.canFight(s, T0 + 3600e3).code, "injured");
  assert.ok(L.canFight({ ...s, energy: 90, health: 90 }, T0 + 49 * 3600e3).ok, "a lesão passa");
  const h = L.birth(8, T0);
  const r2 = L.fightAftermath(h, { outcome: "loss", method: "tko", taken: 120, kd: 3, activeS: 140 }, T0);
  assert.equal(r2.hospital, true);
  assert.equal(h.activity.kind, "hospital");
  assert.ok(r2.events.some((e) => e.kind === "hospital_in" && e.data.reason === "boxe"));
});

test("vida: lesão deixa a cura pela metade", () => {
  const a = L.birth(9, T0);
  const b = L.birth(9, T0);
  for (const s of [a, b]) Object.assign(s, { health: 50, satiety: 70, energy: 80, stress: 20 });
  b.effects.push({ id: "injury", until: T0 + 48 * 3600e3 });
  L.simulate(a, T0 + 3 * 3600e3);
  L.simulate(b, T0 + 3 * 3600e3);
  assert.ok(a.health - 50 > (b.health - 50) * 1.6, `${a.health} × ${b.health}`);
});

test("vida: vitória paga a bolsa até 5 lutas por dia", () => {
  const s = L.birth(7, T0);
  let coins = 0;
  for (let i = 0; i < 7; i++) {
    Object.assign(s, { energy: 90, health: 90, satiety: 70 });
    coins += L.fightAftermath(s, { outcome: "win", method: "points", taken: 10, kd: 0, activeS: 60, purse: 40 }, T0 + i * 60e3).coins;
  }
  assert.equal(coins, 5 * 40);
  assert.equal(s.boxing.w, 7);
});
