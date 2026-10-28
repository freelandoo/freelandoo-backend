// Arena de Boxe do Meu Mundo (mm3d-43 → mm3d-44). A luta agora é AO VIVO: a
// pessoa anda e ataca (combo sorteado), a sala roda a partida (Match). Os casos:
// treino, comida, sono e saúde decidem (computador × computador); a entrada do
// aparelho é limpa (lixo não quebra, combo inválido vira sorteio, joystick
// expira); a pancada respeita alcance, esquiva e guarda; queda, contagem,
// toques para levantar, nocaute técnico; toalha; e a luta volta para a vida
// (cansa, machuca, lesiona, leva ao hospital, paga a bolsa até o limite do dia).
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

/** Computador × computador até o fim. */
function bout(a, b, seed, tier = "even") {
  const m = new B.Match([{ stats: a, cpu: true }, { stats: b, cpu: true, tier }], seed, { intro: 0.5 });
  while (!m.result && m.t < 600) m.step();
  return m;
}
function wins(a, b, n = 60) {
  let w = 0;
  for (let s = 1; s <= n; s++) if (bout(a, b, s * 7919).result.winner === 0) w++;
  return w / n;
}
/** Uma pessoa no canto 0 contra o computador, já no 1º round. */
function live(a = BASE, b = BASE, seed = 3) {
  const m = new B.Match([{ stats: a }, { stats: b, cpu: true }], seed, { intro: 0.1 });
  while (m.phase !== B.PH.ROUND) m.step();
  return m;
}
/** Roda até o combo de A terminar, juntando os eventos de pancada. */
function untilIdle(m, A) {
  const out = [];
  while (A.act.code === B.ACT.COMBO && m.t <= A.act.end + 1e-9) {
    m.step();
    out.push(...m.snapshot().ev.filter((e) => e[1] === B.EV.PUNCH && e[2] === A.i));
  }
  return out;
}

test("mesma semente, mesma luta", () => {
  const a = bout(BASE, BASE, 42);
  const b = bout(BASE, BASE, 42);
  assert.deepEqual(a.result, b.result);
  assert.deepEqual(a.cards, b.cards);
});

test("a partida anda inteira: sinos, intervalos, dentro do ringue, snapshot pequeno", () => {
  for (const seed of [1, 2, 3, 99]) {
    const m = new B.Match([{ stats: BASE, cpu: true }, { stats: { ...BASE, strength: 450 }, cpu: true }], seed, { intro: 0.5 });
    const ev = [];
    let maxLen = 0;
    while (!m.result && m.t < 600) {
      m.step();
      const s = m.snapshot();
      maxLen = Math.max(maxLen, JSON.stringify(s).length);
      ev.push(...s.ev);
      for (const f of s.f) {
        assert.ok(Math.abs(f[0]) <= B.BOXE.RING + 1e-6 && Math.abs(f[1]) <= B.BOXE.RING + 1e-6, "dentro do ringue");
        assert.ok(f[2] >= 0 && f[2] <= 100 && f[3] >= 0 && f[3] <= 100, "barras 0–100");
      }
      const [a, b] = s.f;
      if (s.ph[0] === B.PH.ROUND) assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) >= B.BOXE.MIN_SEP - 0.01, "ninguém atravessa ninguém");
    }
    ev.push(...m.snapshot().ev);
    assert.ok(m.result, "acabou");
    assert.equal(ev[0][1], B.EV.BELL);
    assert.equal(ev.at(-1)[1], B.EV.END);
    assert.ok(ev.filter((e) => e[1] === B.EV.PUNCH).length > 20, "teve luta");
    if (m.result.method === "points" || m.result.method === "draw") {
      assert.equal(m.cards.length, B.BOXE.ROUNDS);
      assert.equal(ev.filter((e) => e[1] === B.EV.BELL).length, B.BOXE.ROUNDS);
    }
    assert.ok(maxLen < 900, `snapshot pequeno (${maxLen})`);
  }
});

test("o treino decide: mais forte ou mais rápido ganha a maioria", () => {
  assert.ok(wins({ ...BASE, strength: 600 }, BASE) > 0.75);
  assert.ok(wins({ ...BASE, speed: 600 }, BASE) > 0.65);
  assert.ok(wins({ ...BASE, strength: 900, speed: 900 }, BASE) > 0.95);
});

test("comida, sono e saúde pesam: com fome, cansado ou doente perde a maioria", () => {
  assert.ok(wins({ ...BASE, satiety: 10 }, BASE) < 0.2);
  assert.ok(wins({ ...BASE, energy: 18 }, BASE) < 0.2);
  assert.ok(wins({ ...BASE, health: 45 }, BASE) < 0.2);
  const f = B.fighter({ ...BASE, satiety: 10, energy: 18, awakeH: 30, stress: 80, health: 50 });
  for (const c of ["hungry", "exhausted", "sleepy", "stressed", "hurt"]) assert.ok(f.conditions.includes(c), c);
});

test("o computador escala com o jogador", () => {
  const easy = B.cpuStats(BASE, "easy", 5);
  const hard = B.cpuStats(BASE, "hard", 5);
  assert.ok(easy.strength < BASE.strength && hard.strength > BASE.strength);
  const vs = (tier) => {
    let w = 0;
    for (let s = 1; s <= 40; s++) if (bout(BASE, B.cpuStats(BASE, tier, s), s * 31, tier).result.winner === 0) w++;
    return w / 40;
  };
  assert.ok(vs("easy") > vs("hard") + 0.2);
});

test("entrada: lixo não quebra, combo inválido vira sorteio, joystick expira", () => {
  const m = live();
  const A = m.F[0];
  m.F[1].cpu = false; // o outro parado
  for (const junk of [null, 5, "x", { m: "a" }, { m: [NaN, 1] }, { a: "lixo" }, { k: -5 }]) m.input(0, junk);
  assert.equal(A.act.code, B.ACT.COMBO, "{ a: 'lixo' } = combo sorteado");
  untilIdle(m, A);
  m.input(0, { a: [99, 1], c: 7 });
  assert.equal(A.act.code, B.ACT.COMBO);
  assert.ok(A.act.pieces.every((p) => p >= 0 && p < B.PIECES.length), "pedaço desconhecido não entra");
  untilIdle(m, A);
  Object.assign(A, { x: 0, z: 0 });
  Object.assign(m.F[1], { x: 2, z: 2 });
  const x0 = A.x;
  m.input(0, { m: [-5, 0] });
  assert.ok(Math.abs(A.move.x + 1) < 1e-9, "joystick grande vira 1");
  for (let i = 0; i < 6; i++) m.step();
  assert.ok(A.x < x0 - 0.2, "andou para a esquerda");
  for (let i = 0; i < 20; i++) m.step();
  const x1 = A.x;
  for (let i = 0; i < 10; i++) m.step();
  assert.ok(Math.abs(A.x - x1) < 0.02, "sem entrada nova, parou");
});

test("pancada: longe erra, esquiva escapa, perto acerta e tira sangue", () => {
  const m = live();
  const [A, D] = m.F;
  D.cpu = false;
  const rest = () => {
    for (let i = 0; i < 30; i++) m.step();
  };
  // longe: erra tudo
  Object.assign(A, { x: -2.2, z: 0 });
  Object.assign(D, { x: 2.2, z: 0 });
  m.input(0, { a: [0], c: 1 });
  const far = untilIdle(m, A);
  assert.ok(far.length >= 1 && far.every((e) => e[3] === B.RES.MISS), "longe = erro");
  rest();
  // esquivando: escapa
  let slip = false;
  for (let k = 0; k < 6 && !slip; k++) {
    Object.assign(A, { x: -0.45, z: 0, stam: 100 });
    Object.assign(D, { x: 0.45, z: 0, stam: 100 });
    m.input(0, { a: [2], c: 2 });
    m.dodge(D);
    slip = untilIdle(m, A).some((e) => e[3] === B.RES.SLIP);
    rest();
  }
  assert.ok(slip, "esquiva = escapou");
  // perto, o outro socando (sem guarda): acerta
  let hit = false;
  for (let k = 0; k < 6 && !hit; k++) {
    Object.assign(A, { x: -0.45, z: 0, stam: 100 });
    Object.assign(D, { x: 0.45, z: 0, stam: 100 });
    const b0 = D.blood;
    m.attack(D, [6]);
    m.input(0, { a: [1], c: 3 });
    hit = untilIdle(m, A).some((e) => e[3] >= B.RES.HIT) && D.blood < b0;
    rest();
  }
  assert.ok(hit, "perto = acerta e tira sangue");
  assert.ok(A.tally.thrown > 0 && A.tally.landed > 0);
});

test("queda: o relógio para, toques ajudam a levantar, 3ª queda = nocaute técnico", () => {
  const m = live();
  const H = m.F[0];
  m.F[1].cpu = false;
  H.blood = 0;
  m.step();
  assert.equal(m.phase, B.PH.COUNT);
  assert.equal(H.down, true);
  const clock = m.clock;
  let up = false;
  for (let i = 0; i < 400 && !up && !m.result; i++) {
    m.input(0, { k: 4 });
    m.step();
    up = m.snapshot().ev.some((e) => e[1] === B.EV.UP);
  }
  assert.ok(up, "levantou tocando");
  assert.equal(m.clock, clock, "o relógio do round parou na contagem");
  assert.equal(m.phase, B.PH.ROUND);
  assert.ok(H.blood > 10 && !H.down);
  H.kd = 2;
  H.blood = 0;
  m.step();
  assert.equal(m.result.method, "tko");
  assert.equal(m.result.winner, 1);
  assert.equal(m.summary(0).outcome, "loss");
  assert.equal(m.summary(0).kd, 3);
});

test("sem toque e sem queixo, a contagem chega a 10: nocaute", () => {
  const m = live({ ...BASE, strength: 10, leanKg: 46, health: 45 });
  m.F[1].cpu = false;
  const H = m.F[0];
  H.kd = 1;
  H.tally.taken = 200;
  H.blood = 0;
  m.step();
  m.count.need = 99; // não levanta
  while (!m.result && m.t < 30) m.step();
  assert.equal(m.result.method, "ko");
  assert.equal(m.summary(1).outcome, "win");
});

test("toalha: quem joga perde ali", () => {
  const m = live();
  for (let i = 0; i < 100; i++) m.step();
  assert.equal(m.towel(0), true);
  assert.equal(m.summary(0).outcome, "loss");
  assert.equal(m.summary(0).method, "towel");
  assert.equal(m.summary(1).outcome, "win");
  assert.equal(m.towel(1), false, "depois do fim não muda");
});

test("tabela para o aparelho: pedaços dentro do clipe, pancadas dentro do pedaço", () => {
  const t = B.Match.table();
  assert.equal(t.pieces.length, B.PIECES.length);
  for (const p of t.pieces) {
    assert.ok(p.from >= 0 && p.to <= 1 && p.from < p.to);
    for (const [at] of p.hits) assert.ok(at > 0 && at < p.dur);
  }
  for (let i = 0; i < 50; i++) {
    const c = B.randomCombo(B.rng(i + 1), 3);
    assert.equal(c.length, 3);
    assert.ok(B.validCombo(c));
  }
  assert.equal(B.validCombo([1, 2, 3, 4]), null);
  assert.equal(B.validCombo([]), null);
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
