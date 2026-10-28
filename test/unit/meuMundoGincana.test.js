// test/unit/meuMundoGincana.test.js — MEU MUNDO 3D: Gincana (mm3d-47)
//
// A regra mora no front (features/meu-mundo/gincana/sim/*.ts) e o back roda a
// cópia GERADA (src/utils/meuMundoGincana.js). Aqui: a cópia está em dia; o
// percurso fecha (postos em ordem, chegada no alto da subida); 8 computadores
// terminam a prova e a mesma semente dá a mesma chegada; a barra derruba quem
// fica parado e não quem pula; o ladrilho cai depois de pisado e volta; quem
// cai na água volta ao último posto; em grupo, a sala (gente pela rede +
// computadores) vê a pessoa chegar.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const G = require("../../src/utils/meuMundoGincana");

process.removeAllListeners("warning");

const bots = (n) => Array.from({ length: n }, (_, slot) => ({ slot, ctl: "bot" }));

function runAll(race, maxT = G.GINCANA.timeLimit) {
  const ev = [];
  const hits = {};
  let falls = 0;
  while (race.t < maxT && race.order.length < race.runners.length) {
    race.step(undefined, ev);
    for (const e of ev) {
      if (e.type === "hit") hits[e.by] = (hits[e.by] || 0) + 1;
      if (e.type === "splash") falls++;
    }
    ev.length = 0;
  }
  return { hits, falls };
}

test("gincana — a cópia do back está em dia com o front", (t) => {
  const gen = require("../../scripts/build-gincana-sim");
  if (!fs.existsSync(gen.SIM)) return t.skip("front fora do lugar");
  const cur = fs.readFileSync(gen.OUT, "utf8").replace(/\r\n/g, "\n");
  assert.equal(cur, gen.build(), "rode node scripts/build-gincana-sim.js");
});

test("gincana — percurso: postos em ordem, chegada no alto da subida, trechos com obstáculos", () => {
  for (let i = 1; i < G.CHECKPOINTS.length; i++) assert.ok(G.CHECKPOINTS[i].z > G.CHECKPOINTS[i - 1].z);
  assert.ok(G.FINISH_Z > G.CHECKPOINTS[G.CHECKPOINTS.length - 1].z + 30);
  assert.equal(G.FINISH_Y, G.RAMP.y1);
  assert.ok(G.SWEEPERS.length >= 4 && G.PENDULUMS.length >= 8 && G.GLOVES.length >= 6);
  assert.equal(G.TILES.length, G.TILE_COLS * G.TILE_ROWS);
  // cada posto e cada vaga da largada têm chão embaixo
  const w = { t: 0, seed: 1, tiles: new Float64Array(G.TILES.length).fill(-1), balls: [] };
  for (let cp = 0; cp < G.CHECKPOINTS.length; cp++) {
    for (let slot = 0; slot < 8; slot++) {
      const p = G.spawnAt(cp, slot);
      assert.equal(G.groundUnder(w, p.x, p.z, p.y + 0.5).y, p.y, `posto ${cp} vaga ${slot}`);
    }
  }
});

test("gincana — 8 computadores terminam a prova (e a mesma semente chega igual)", () => {
  let done = 0;
  for (const seed of [1, 2, 3, 4]) {
    const race = new G.GincanaRace(seed, bots(8));
    runAll(race);
    done += race.order.length;
    assert.ok(race.order.length >= 7, `semente ${seed}: ${race.order.length} chegaram`);
    const first = race.runner(race.order[0]).fin;
    assert.ok(first > 30 && first < 120, `primeiro em ${first}`);
  }
  assert.ok(done >= 31);
  const a = new G.GincanaRace(77, bots(8));
  const b = new G.GincanaRace(77, bots(8));
  runAll(a);
  runAll(b);
  assert.deepEqual(a.order, b.order);
  assert.deepEqual(
    a.order.map((s) => a.runner(s).fin),
    b.order.map((s) => b.runner(s).fin)
  );
});

test("gincana — a barra do carrossel derruba quem fica parado e não quem pula na hora", () => {
  const s = G.SWEEPERS[0];
  // parado na frente da barra, a 6 m do centro do primeiro disco
  const standAt = (jumpAhead) => {
    const race = new G.GincanaRace(1, [{ slot: 0, ctl: "local" }], 0);
    const r = race.runner(0);
    // o ângulo do corpo: a barra chega em ~1 s
    const ang = G.sweeperAngle(s, 1);
    Object.assign(r, { x: s.x + Math.sin(ang) * 6, z: s.z + Math.cos(ang) * 6, y: G.DECK, ground: true });
    const ev = [];
    let hit = false;
    for (let k = 0; k < 120; k++) {
      // o contato começa um pouco antes do alinhamento (grossura da barra e do corpo)
      const jump = jumpAhead !== null && Math.abs(race.t + G.GINCANA.step - (1 - jumpAhead)) < G.GINCANA.step / 2;
      race.step({ mx: 0, mz: 0, jump, dive: false }, ev);
      if (ev.some((e) => e.type === "hit" && e.by === "bar")) hit = true;
      ev.length = 0;
    }
    return hit;
  };
  assert.equal(standAt(null), true, "parado leva a barrada");
  assert.equal(standAt(0.3), false, "pulando ~0,3 s antes passa por cima");
});

test("gincana — o ladrilho treme, cai depois de pisado e volta", () => {
  const race = new G.GincanaRace(1, [{ slot: 0, ctl: "local" }], 0);
  const r = race.runner(0);
  const tile = G.TILES[8];
  Object.assign(r, { x: tile.x, z: tile.z, y: G.DECK + 0.01, ground: false, cp: 3 });
  const ev = [];
  let stepped = false;
  for (let k = 0; k < 20 && !stepped; k++) {
    race.step(undefined, ev);
    stepped = ev.some((e) => e.type === "tile" && e.i === 8);
    ev.length = 0;
  }
  assert.ok(stepped, "pisou");
  const at = race.world.tiles[8];
  assert.ok(G.tileUp(at, at + G.TILE_TIME.warn * 0.5), "ainda treme em pé");
  assert.equal(G.tileUp(at, at + G.TILE_TIME.warn + 0.1), false, "caiu");
  // quem ficou em cima cai na água e volta ao posto do xadrez
  let splash = false;
  let back = false;
  for (let k = 0; k < 60 * 4; k++) {
    race.step(undefined, ev);
    if (ev.some((e) => e.type === "splash")) splash = true;
    if (ev.some((e) => e.type === "back")) back = true;
    ev.length = 0;
  }
  assert.ok(splash && back);
  assert.ok(Math.abs(r.z - G.spawnAt(3, 0).z) < 1, `voltou ao posto: z ${r.z}`);
  for (let k = 0; k < 60 * 5; k++) race.step(undefined, ev);
  assert.equal(race.world.tiles[8], -1, "o ladrilho voltou");
});

test("gincana — em grupo: a sala (pessoa pela rede + computadores) vê a pessoa chegar", () => {
  const seed = 9;
  // o "aparelho": a pessoa é movida por um robô (a regra do computador) no lugar do controle
  const device = new G.GincanaRace(seed, [{ slot: 0, ctl: "bot" }, ...[1, 2, 3].map((slot) => ({ slot, ctl: "remote" }))]);
  const server = new G.GincanaRace(seed, [{ slot: 0, ctl: "remote" }, ...[1, 2, 3].map((slot) => ({ slot, ctl: "bot" }))]);
  let poseAt = 0;
  while (device.t < G.GINCANA.timeLimit && server.t < G.GINCANA.timeLimit) {
    device.step();
    server.step();
    if (device.t >= poseAt) {
      poseAt = device.t + 0.05;
      server.setRemote(0, device.pose(0));
      for (const s of [1, 2, 3]) device.setRemote(s, server.pose(s));
    }
    if (server.over() && server.runner(0).fin >= 0) break;
  }
  const me = server.runner(0);
  assert.ok(me.fin > 0, "chegou na sala");
  assert.ok(server.order.includes(0));
  assert.equal(server.over(), true, "sem mais ninguém de fora: acabou");
  const st = server.standings();
  assert.equal(st.length, 4);
  assert.ok(st.findIndex((r) => r.slot === 0) >= 0);
});
