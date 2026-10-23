// Roteiro comum do fixture de ouro do jetpack (mm3d-21): o gravador e o teste
// rodam exatamente isto. `World` + `autopilot` vêm do front (ou de quem imitar
// a mesma API) — assim o mesmo roteiro confere front e back.
"use strict";

const SEEDS = [1, 7, 42, 1234, 99999];
const MAX_STEPS = 14400; // 120 s de jogo
const EVERY = 60;

// `|| 0`: -0 vira 0 (o JSON do fixture não guarda -0 e o deepStrictEqual distingue).
const r6 = (v) => Math.round(v * 1e6) / 1e6 || 0;

/** Segura 30 passos e solta 40, a partir do primeiro toque (cai, bate, morre — exercita a morte). */
const pulse = () => (_w, i) => i % 70 < 30;

/**
 * Piloto até o primeiro turbo; depois voa reto na altura de largada: quebra
 * pilastras com o turbo e morre num obstáculo quando ele acaba.
 */
const ram = (autopilot) => {
  let straight = false;
  return (w) => {
    if (w.powered) straight = true;
    if (!straight) return autopilot(w);
    return w.y + (w.vy > 0 ? (w.vy * w.vy) / (2 * w.tune.gravity) : 0) < w.tune.startY;
  };
};

function run(World, input, seed) {
  const w = new World(seed);
  const samples = [];
  const events = [];
  for (let i = 0; i < MAX_STEPS && w.state !== "dead"; i++) {
    w.step(input(w, i));
    for (const e of w.drain()) events.push([w.ticks, e.type, e.kind || e.cause || e.phase || e.obstacle || ""]);
    if (i % EVERY === 0) {
      samples.push({
        i,
        t: r6(w.t),
        x: r6(w.x),
        y: r6(w.y),
        vy: r6(w.vy),
        fuel: r6(w.fuel.value !== undefined ? w.fuel.value : w.fuel.ratio),
        st: w.state,
        obs: w.obstacles.map((o) => [o.id, o.kind, r6(o.x), r6(o.w), o.broken]).join(";"),
        pick: w.pickups.map((p) => [p.id, p.kind, r6(p.x), r6(p.y), p.taken ? 1 : 0]).join(";"),
      });
    }
  }
  return { seed, ticks: w.ticks, state: w.state, distance: r6(w.distance), samples, events };
}

function golden(World, autopilot) {
  const out = {};
  for (const seed of SEEDS) {
    out[`auto-${seed}`] = run(World, (w) => autopilot(w), seed);
    out[`pulse-${seed}`] = run(World, pulse(), seed);
    out[`ram-${seed}`] = run(World, ram(autopilot), seed);
  }
  return out;
}

module.exports = { golden, SEEDS };
