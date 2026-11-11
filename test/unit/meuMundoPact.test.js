// test/unit/meuMundoPact.test.js — lore v2 D4: as fases do deus chefão (regra da luta) e o
// pacto do deus vencido (néctar extra no jogável dele para o povo de quem venceu).
const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../../src/utils/meuMundoFight");
const D = require("../../src/utils/meuMundoDomains");
const P = require("../../src/utils/meuMundoPact");
const S = require("../../src/utils/meuMundoScores");

const noctis = (boss) => new F.Fight({ kind: "ciborgue", level: 7, hero: 5, tier: "domain", seed: 4242, stats: { strength: 100, speed: 100, intelligence: 100, dexterity: 100 }, boss });

test("D4: só o setor 10 da Floresta tem chefão com fases (Noctis); a tela manda", () => {
  assert.equal(D.bossOf("floresta", 10), "noctis");
  for (let s = 1; s < 10; s++) assert.equal(D.bossOf("floresta", s), null, `setor ${s}`);
  assert.equal(D.bossOf("canion", 10), null, "o Cânion ainda não tem fatia");
  const fl = D.view(5, {})[0];
  assert.equal(fl.sectors[9].boss, "noctis");
  assert.equal(fl.sectors[8].boss, null);
});

test("D4: fases pela vida — 66% abre a Lua Minguante (Eclipse), 33% a Lua Nova (garra e salto)", () => {
  const f = noctis("noctis");
  assert.equal(f.boss, "noctis");
  const m = f.mobs[0];
  assert.equal(m.phase, 0);
  const n0 = m.attacks.length;
  m.hp = Math.round(m.hpMax * 0.7);
  assert.equal(f.bossPhase(m), false, "acima de 66% nada muda");
  m.hp = Math.round(m.hpMax * 0.6);
  f.events = [];
  assert.equal(f.bossPhase(m), true);
  assert.equal(m.phase, 1);
  assert.equal(m.state, "roar");
  assert.deepEqual(f.events, [{ t: "phase", id: m.id, phase: 2 }]);
  assert.ok(m.attacks.some((a) => a.id === "eclipse"));
  assert.equal(m.attacks.length, n0 + 1);
  assert.ok(m.restMul < 1 && m.speedMul > 1);
  m.hp = Math.round(m.hpMax * 0.2);
  f.events = [];
  assert.equal(f.bossPhase(m), true);
  assert.deepEqual(f.events, [{ t: "phase", id: m.id, phase: 3 }]);
  assert.ok(m.attacks.some((a) => a.id === "moonClaw") && m.attacks.some((a) => a.id === "moonPounce"));
  assert.equal(f.bossPhase(m), false, "a mesma fase não abre duas vezes");
});

test("D4: golpe que pula duas fases soma as duas e avisa uma vez", () => {
  const f = noctis("noctis");
  const m = f.mobs[0];
  m.hp = 1;
  f.events = [];
  assert.equal(f.bossPhase(m), true);
  assert.equal(m.phase, 2);
  assert.deepEqual(f.events, [{ t: "phase", id: m.id, phase: 3 }]);
  assert.ok(["eclipse", "moonClaw", "moonPounce"].every((id) => m.attacks.some((a) => a.id === id)));
});

test("D4: sem chefão a luta não muda (luta antiga, ticket sem boss, boss desconhecido)", () => {
  for (const boss of [undefined, "nada"]) {
    const f = noctis(boss);
    assert.equal(f.boss, null);
    const m = f.mobs[0];
    assert.equal(m.restMul, 1);
    assert.equal(m.speedMul, 1);
  }
  // mesma semente e mesmas entradas: a luta sem chefão chega ao mesmo fim que antes (sem evento de fase)
  const run = (boss) => {
    const f = noctis(boss);
    const C = require("../../scripts/mm-domain-calibrate");
    const mem = { react: 0 };
    let phases = 0;
    for (let k = 0; k < 4 * 60 * 60 && !f.over; k++) {
      f.step(C.botInput(f, mem));
      phases += f.events.filter((e) => e.t === "phase").length;
    }
    return { over: f.over, hp: f.mobs[0].hp, phases };
  };
  const plain = run(undefined);
  assert.equal(plain.phases, 0);
  assert.deepEqual(run(null), plain);
});

test("D4: com fases o robô do Poder recomendado segue vencendo menos da metade contra Noctis", () => {
  const C = require("../../scripts/mm-domain-calibrate");
  const w = C.winRate("ciborgue", D.sectorLevel("floresta", 10), D.recommendedPower("floresta", 10), D.heroOf("floresta", 10), 24, "noctis");
  assert.ok(w > 0.1 && w <= 0.6, `setor 10 com fases: ${w}`);
});

test("D4: cada deus tem o seu jogável no placar (a janela do Domínio)", () => {
  const games = new Set(S.GAMES.map((g) => g.id));
  for (const d of D.DOMAINS) assert.ok(games.has(P.gameOfGod(d.god)), d.god);
  assert.equal(P.gameOfGod("noctis"), "noturno");
  assert.equal(P.gameOfGod("aurion"), null, "deus sem Domínio não tem pacto");
});

test("D4: pacto de 7 dias — a semana leva a fração do bônus pelo tempo de pacto dentro dela", () => {
  const week = "2026-11-15";
  const r = S.weekRange(week);
  const day = 24 * 3600 * 1000;
  assert.equal(P.PACT_MS, 7 * day);
  // pacto que cobre a semana inteira = bônus inteiro
  assert.equal(P.weekShare(week, [{ startsAt: r.start, endsAt: r.end }]), 1);
  // começou na quarta: 4 dias nesta semana, 3 na seguinte
  const w = P.window(r.start + 3 * day);
  assert.equal(w.endsAt - w.startsAt, P.PACT_MS);
  const a = P.weekShare(week, [w]);
  const b = P.weekShare(S.weekOf(r.end + 1), [w]);
  assert.ok(Math.abs(a - 4 / 7) < 1e-9 && Math.abs(b - 3 / 7) < 1e-9);
  assert.ok(Math.abs(a + b - 1) < 1e-9, "o pacto paga 7 dias no total, nunca mais");
  assert.equal(P.weekShare(week, []), 0);
  assert.equal(P.weekShare(week, [{ startsAt: r.end, endsAt: r.end + day }]), 0, "pacto fora da semana");
  // teto em 1
  assert.equal(P.weekShare(week, [{ startsAt: r.start, endsAt: r.end }, { startsAt: r.start, endsAt: r.end }]), 1);
});

test("D4: bônus em mL inteiros (+50% com a semana inteira)", () => {
  assert.equal(P.PACT_BONUS, 0.5);
  assert.equal(P.bonusMl(10000, 1), 5000);
  assert.equal(P.bonusMl(4000, 4 / 7), 1143);
  assert.equal(P.bonusMl(1000, 0), 0);
  assert.equal(P.bonusMl(1000, 2), 500, "fração com teto");
  assert.ok(Number.isInteger(P.bonusMl(3750, 3 / 7)));
});
