// Rolê Noturno 2.0 (2026-11-09): as rotas com curvas, descidas e loops. A regra é a mesma
// (o traçado só dá forma à pista); o gerador deixa a zona de cada loop sem obstáculo, o
// computador da sala atravessa os loops, e a Clássica continua idêntica à de antes.
const test = require("node:test");
const assert = require("node:assert/strict");
const { Run, TrackPlan, TrackGeom, newFrame, RUN_PHASES, KINDS, QUIET_BEFORE, QUIET_AFTER } = require("../../src/utils/meuMundoNoturnoSim");
const { NoturnoBot } = require("../../src/utils/meuMundoNoturnoBot");

const NONE = { left: false, right: false, jump: false, down: false };
const NEW = RUN_PHASES.filter((p) => p !== "classica");

test("cada rota nova tem loops, e nenhum obstáculo encosta na zona de um loop", () => {
  for (const phase of NEW) {
    for (const seed of [1, 77, 4242]) {
      const r = new Run("skate", seed, "bike", phase);
      // gera ~12 km de rua (sem andar) e confere cada obstáculo contra as zonas
      r.generate(12000);
      const plan = new TrackPlan(phase, seed);
      plan.ensure(12000);
      const loops = plan.segs.filter((s) => s.kind === "loop");
      assert.ok(loops.length >= 4, `${phase}/${seed}: ${loops.length} loops em 12 km`);
      for (const o of r.obstacles) {
        const b = o.z + KINDS[o.kind].len;
        for (const L of loops) {
          const from = L.s0 - QUIET_BEFORE;
          const to = L.s0 + L.len + QUIET_AFTER;
          assert.ok(b <= from || o.z >= to, `${phase}/${seed}: ${o.kind} em ${o.z.toFixed(0)} dentro do loop ${from.toFixed(0)}–${to.toFixed(0)}`);
        }
      }
    }
  }
});

test("o loop dá a volta inteira: cima invertido no alto, de pé na saída", () => {
  for (const phase of NEW) {
    const plan = new TrackPlan(phase, 4242);
    plan.ensure(3000);
    const g = new TrackGeom(plan);
    const L = plan.segs.find((s) => s.kind === "loop");
    const top = g.frame(L.s0 + L.len / 2, newFrame());
    const out = g.frame(L.s0 + L.len + 1, newFrame());
    assert.ok(top.uy < -0.9, `${phase}: cima no alto ${top.uy}`);
    assert.ok(out.uy > 0.999, `${phase}: cima na saída ${out.uy}`);
    assert.ok(top.py - g.frame(L.s0, newFrame()).py > 20, `${phase}: loop baixo demais`);
  }
});

test("a Clássica não mudou: sem rota = rota clássica (mesma rua, mesmos eventos)", () => {
  for (const seed of [3, 4242]) {
    const a = new Run("bike", seed, "bike");
    const b = new Run("bike", seed, "bike", "classica");
    const ea = [];
    const eb = [];
    for (let i = 0; i < 120 * 60; i++) {
      const jump = i % 97 === 0;
      a.step({ ...NONE, jump }, ea);
      b.step({ ...NONE, jump }, eb);
    }
    assert.equal(a.track, null);
    assert.deepEqual(eb, ea);
    assert.equal(b.score, a.score);
  }
});

test("o computador da sala atravessa os loops de cada rota", () => {
  for (const phase of NEW) {
    const b = new NoturnoBot({ ride: "skate", seed: 4242, street: "bike", skill: 1, luck: 9, phase });
    const plan = new TrackPlan(phase, 4242);
    plan.ensure(2500);
    const first = plan.segs.find((s) => s.kind === "loop");
    let t = 0;
    while (b.run.alive && b.run.z < first.s0 + first.len + 60 && t < 240) {
      b.advance(0.05);
      t += 0.05;
    }
    assert.ok(b.run.z > first.s0 + first.len, `${phase}: o computador parou em ${b.run.z.toFixed(0)} (loop em ${first.s0.toFixed(0)})`);
  }
});
