// test/unit/meuMundoGincana.test.js — MEU MUNDO 3D: Gincana (mm3d-47; 2.0 em 2026-11-16)
//
// A regra mora no front (features/meu-mundo/gincana/sim/*.ts) e o back roda a
// cópia GERADA (src/utils/meuMundoGincana.js). Aqui: a cópia está em dia; cada
// fase fecha (postos em ordem com chão embaixo, chegada no alto da subida); 8
// computadores classificam 6 em todas as fases e a mesma semente dá a mesma
// chegada; a barra derruba quem fica parado e não quem pula; o ladrilho cai
// depois de pisado e volta; quem cai na água volta ao último posto; peças da
// 2.0 (cogumelo, porta, esteira, plataforma que anda, beira, agarrar,
// classificação); em grupo, a sala (gente pela rede + computadores) vê a
// pessoa chegar.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const G = require("../../src/utils/meuMundoGincana");

process.removeAllListeners("warning");

const bots = (n) => Array.from({ length: n }, (_, slot) => ({ slot, ctl: "bot" }));
const C0 = G.COURSES.cidade;

function runAll(race, maxT = G.GINCANA.timeLimit) {
  const ev = [];
  const hits = {};
  let falls = 0;
  while (race.t < maxT && !race.over()) {
    race.step(undefined, ev);
    for (const e of ev) {
      if (e.type === "hit") hits[e.by] = (hits[e.by] || 0) + 1;
      if (e.type === "splash") falls++;
    }
    ev.length = 0;
  }
  return { hits, falls };
}

/** Uma prova de um corpo só ("local") na fase, sem contagem. */
function solo(phase = "cidade", seed = 1) {
  const race = new G.GincanaRace(seed, [{ slot: 0, ctl: "local" }], 0, phase);
  return { race, r: race.runner(0) };
}

test("gincana — a cópia do back está em dia com o front", (t) => {
  const gen = require("../../scripts/build-gincana-sim");
  if (!fs.existsSync(gen.SIM)) return t.skip("front fora do lugar");
  const cur = fs.readFileSync(gen.OUT, "utf8").replace(/\r\n/g, "\n");
  assert.equal(cur, gen.build(), "rode node scripts/build-gincana-sim.js");
});

test("gincana — 7 fases; cada uma fecha: postos em ordem com chão, chegada no alto da subida", () => {
  assert.deepEqual([...G.GINCANA_PHASES], ["cidade", "floresta", "canion", "orbital", "forja", "fabrica", "gelo"]);
  for (const ph of G.GINCANA_PHASES) {
    const C = G.COURSES[ph];
    assert.equal(C.id, ph);
    for (let i = 1; i < C.checkpoints.length; i++) assert.ok(C.checkpoints[i].z > C.checkpoints[i - 1].z, `${ph} posto ${i}`);
    assert.ok(C.finishZ > C.checkpoints[C.checkpoints.length - 1].z + 30, ph);
    // chegada no alto da ÚLTIMA subida (a Maré do Pântano tem várias)
    const ramps = C.pads.filter((p) => p.k === 2);
    assert.equal(C.finishY, ramps[ramps.length - 1].y2, ph);
    assert.equal(C.sections.length, 5, ph);
    const w = G.newWorld(C, 1, 0);
    for (let cp = 0; cp < C.checkpoints.length; cp++) {
      for (let slot = 0; slot < 8; slot++) {
        const p = G.spawnAt(C, cp, slot);
        assert.equal(G.groundUnder(w, p.x, p.z, p.y + 0.5).y, p.y, `${ph} posto ${cp} vaga ${slot}`);
      }
    }
  }
  // a de sempre continua com os números de antes
  assert.equal(C0.finishZ, 266);
  assert.ok(C0.sweepers.length >= 4 && C0.pendulums.length >= 8 && C0.gloves.length >= 6);
  assert.equal(C0.tiles.length, 42);
  assert.equal(G.courseOf("nada").id, "cidade");
});

test("gincana — em todas as fases 8 computadores classificam 6 (e a mesma semente chega igual)", () => {
  for (const ph of G.GINCANA_PHASES) {
    for (const seed of [1, 2, 3]) {
      const race = new G.GincanaRace(seed, bots(8), 3, ph);
      runAll(race);
      assert.equal(race.quota, 6);
      assert.equal(race.order.length, 6, `${ph} semente ${seed}: ${race.order.length} classificados`);
      const first = race.runner(race.order[0]).fin;
      assert.ok(first > 18 && first < 100, `${ph}: primeiro em ${first}`);
    }
  }
  const a = new G.GincanaRace(77, bots(8), 3, "orbital");
  const b = new G.GincanaRace(77, bots(8), 3, "orbital");
  runAll(a);
  runAll(b);
  assert.deepEqual(a.order, b.order);
  assert.deepEqual(
    a.order.map((s) => a.runner(s).fin),
    b.order.map((s) => b.runner(s).fin)
  );
});

test("gincana — classificação: quando a vaga enche a prova fecha e quem chega depois não conta", () => {
  const race = new G.GincanaRace(5, bots(8), 3, "cidade");
  runAll(race);
  assert.equal(race.over(), true);
  assert.equal(race.closed(), true);
  const st = race.standings();
  assert.equal(st.filter((r) => r.q).length, 6);
  assert.equal(st.length, 8);
  assert.ok(st.slice(6).every((r) => !r.q && r.fin === -1));
  assert.equal(G.qualifyOf(4), 3);
  assert.equal(G.qualifyOf(1), 1);
});

test("gincana — a barra do carrossel derruba quem fica parado e não quem pula na hora", () => {
  const s = C0.sweepers[0];
  const standAt = (jumpAhead) => {
    const { race, r } = solo();
    const ang = G.sweeperAngle(s, 1);
    Object.assign(r, { x: s.x + Math.sin(ang) * 6, z: s.z + Math.cos(ang) * 6, y: G.DECK, ground: true });
    const ev = [];
    let hit = false;
    for (let k = 0; k < 120; k++) {
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

test("gincana — o ladrilho treme, cai depois de pisado e volta; quem cai volta ao posto", () => {
  const { race, r } = solo();
  const tile = C0.tiles[8];
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
  assert.ok(G.tileUp(C0, at, at + C0.tileTime.warn * 0.5), "ainda treme em pé");
  assert.equal(G.tileUp(C0, at, at + C0.tileTime.warn + 0.1), false, "caiu");
  let splash = false;
  let back = false;
  for (let k = 0; k < 60 * 4; k++) {
    race.step(undefined, ev);
    if (ev.some((e) => e.type === "splash")) splash = true;
    if (ev.some((e) => e.type === "back")) back = true;
    ev.length = 0;
  }
  assert.ok(splash && back);
  assert.ok(Math.abs(r.z - G.spawnAt(C0, 3, 0).z) < 1, `voltou ao posto: z ${r.z}`);
  for (let k = 0; k < 60 * 5; k++) race.step(undefined, ev);
  assert.equal(race.world.tiles[8], -1, "o ladrilho voltou");
});

test("gincana 2.0 — cogumelo lança quem pousa", () => {
  // nenhuma fase usa o cogumelo agora (Gincana 3): a peça é testada num percurso de teste
  const m = { x: 30, z: 30, r: 1.9, y0: -1.2, y1: G.DECK - 0.25, c: 4, b: 10.5 };
  const C = { ...C0, posts: [...C0.posts, m] };
  const w = G.newWorld(C, 1, 0);
  const r = G.newRunner(C, 0);
  Object.assign(r, { x: m.x, z: m.z, y: m.y1 + 0.4, ground: false, vy: -2 });
  const ev = [];
  let bounced = false;
  let top = 0;
  for (let k = 0; k < 60; k++) {
    w.t += G.GINCANA.step;
    G.stepRunner(r, G.IDLE_INTENT, w, ev);
    if (ev.some((e) => e.type === "bounce")) bounced = true;
    top = Math.max(top, r.y);
    ev.length = 0;
  }
  assert.ok(bounced);
  assert.ok(top > m.y1 + 1.6, `subiu até ${top}`);
});

test("gincana 2.0 — porta: a falsa segura, a de verdade abre e deixa passar", () => {
  const C = G.COURSES.fabrica;
  const { race, r } = solo("fabrica", 3);
  const open = race.world.open;
  const row0 = C.doors.map((d, i) => ({ d, i })).filter((x) => x.d.row === 0);
  assert.equal(row0.filter((x) => open[x.i]).length, 2, "2 de 5 abrem");
  const runInto = (door) => {
    Object.assign(r, { x: door.x, z: door.z - 3, y: G.DECK, ground: true, vx: 0, vz: 0, mode: 0, cp: 2 });
    for (let k = 0; k < 90; k++) race.step({ mx: 0, mz: 1, jump: false, dive: false });
    return r.z;
  };
  const real = row0.find((x) => open[x.i]);
  const fake = row0.find((x) => !open[x.i]);
  assert.ok(runInto(real.d) > real.d.z + 2, "passou pela de verdade");
  assert.ok(race.world.doors[real.i] >= 0, "a porta abriu");
  assert.ok(runInto(fake.d) < fake.d.z, "a falsa segurou");
  // a semente muda quais abrem
  const other = G.doorsOpen(C, 99);
  assert.equal(other.reduce((a, v) => a + v, 0), C.doorOpen.reduce((a, v) => a + v, 0));
});

test("gincana 2.0 — esteira arrasta e plataforma que anda leva quem está em cima", () => {
  const C = G.COURSES.orbital;
  const belt = C.pads.find((p) => p.bz < 0);
  const { race, r } = solo("orbital");
  Object.assign(r, { x: belt.x, z: belt.z, y: G.DECK, ground: true });
  for (let k = 0; k < 60; k++) race.step();
  assert.ok(r.z < belt.z - 2.5, `parado na esteira foi para trás: ${r.z - belt.z}`);

  const Cc = G.COURSES.canion;
  const idx = Cc.pads.findIndex((p) => p.mw !== 0);
  const p = Cc.pads[idx];
  const s2 = solo("canion");
  s2.race.t = 0;
  const sh0 = G.padShift(p, 0);
  Object.assign(s2.r, { x: p.x + sh0.dx, z: p.z, y: G.DECK, ground: true, pad: idx });
  for (let k = 0; k < 30; k++) s2.race.step();
  const sh1 = G.padShift(p, s2.race.t);
  assert.ok(Math.abs(s2.r.x - (p.x + sh1.dx)) < 0.3, `foi junto: ${s2.r.x} × ${p.x + sh1.dx}`);
  assert.ok(s2.r.y > G.DECK - 0.01);
});

test("gincana 2.0 — gelo escorrega: soltou o controle, demora a parar", () => {
  const C = G.COURSES.gelo;
  const lake = C.pads.find((p) => p.f < 0.5);
  const stopAfter = (x, z) => {
    const { race, r } = solo("gelo");
    Object.assign(r, { x, z, y: G.DECK, ground: true });
    for (let k = 0; k < 40; k++) race.step({ mx: 1, mz: 0, jump: false, dive: false });
    const x0 = r.x;
    for (let k = 0; k < 30; k++) race.step();
    return r.x - x0;
  };
  const ice = stopAfter(lake.x - 5, lake.z - 10);
  const normal = stopAfter(-6, 0);
  assert.ok(ice > normal * 2, `gelo ${ice} × chão ${normal}`);
});

test("gincana 2.0 — bate de lado na plataforma pulando: sobe na beira", () => {
  const { race, r } = solo("cidade");
  // na água entre a largada e a ponte não há vão; usa a lateral do patamar da chegada (y = 9)
  const fin = C0.pads[C0.pads.length - 1];
  Object.assign(r, { x: fin.x - fin.hx - 0.6, z: fin.z, y: fin.y - 0.9, vy: 0, ground: false, mode: 0 });
  const ev = [];
  let climbed = false;
  for (let k = 0; k < 40; k++) {
    race.step({ mx: 1, mz: 0, jump: false, dive: false }, ev);
    if (ev.some((e) => e.type === "climb")) climbed = true;
    ev.length = 0;
  }
  assert.ok(climbed, "subiu");
  assert.ok(Math.abs(r.y - fin.y) < 0.01 && r.ground, `em cima: y ${r.y}`);
});

test("gincana 2.0 — agarrar segura quem está na frente e deixa os dois devagar", () => {
  const race = new G.GincanaRace(1, [{ slot: 0, ctl: "local" }, { slot: 1, ctl: "bot" }], 0, "cidade");
  const a = race.runner(0);
  const b = race.runner(1);
  Object.assign(a, { x: 0, z: 2, y: G.DECK, facing: 0 });
  Object.assign(b, { x: 0, z: 3, y: G.DECK });
  const ev = [];
  race.step({ mx: 0, mz: 1, jump: false, dive: false, grab: true }, ev);
  assert.ok(ev.some((e) => e.type === "grab" && e.other === 1));
  assert.equal(a.grab, 1);
  assert.equal(race.pose(0).g, 1, "a pose leva quem está agarrado");
  for (let k = 0; k < 20; k++) race.step({ mx: 0, mz: 1, jump: false, dive: false, grab: true });
  assert.ok(b.held > 0, "o da frente está sendo segurado");
  assert.ok(Math.hypot(a.vx, a.vz) < G.GINCANA.run * 0.5, "quem segura anda devagar");
  race.step({ mx: 0, mz: 1, jump: false, dive: false, grab: false });
  assert.equal(a.grab, -1, "soltou");
});

test("gincana — em grupo: a sala (pessoa pela rede + computadores) vê a pessoa chegar", () => {
  const seed = 9;
  for (const ph of ["cidade", "fabrica"]) {
    const device = new G.GincanaRace(seed, [{ slot: 0, ctl: "bot" }, ...[1, 2, 3].map((slot) => ({ slot, ctl: "remote" }))], 3, ph);
    const server = new G.GincanaRace(seed, [{ slot: 0, ctl: "remote" }, ...[1, 2, 3].map((slot) => ({ slot, ctl: "bot" }))], 3, ph);
    let poseAt = 0;
    while (device.t < G.GINCANA.timeLimit && server.t < G.GINCANA.timeLimit) {
      device.step();
      server.step();
      if (device.t >= poseAt) {
        poseAt = device.t + 0.05;
        server.setRemote(0, device.pose(0));
        for (const s of [1, 2, 3]) device.setRemote(s, server.pose(s));
      }
      if (server.over()) break;
    }
    assert.equal(server.over(), true, `${ph}: acabou`);
    const st = server.standings();
    assert.equal(st.length, 4);
    // a pessoa chegou e está entre os classificados (a prova acaba quando todas as pessoas chegam)
    assert.ok(server.runner(0).fin > 0, `${ph}: chegou na sala`);
    assert.equal(st.find((r) => r.slot === 0).q, true, `${ph}: classificou`);
    assert.ok(st.filter((r) => r.q).length <= 3);
  }
});

// ── Gincana 3 (2026-11-18): tipos de prova ───────────────────────────────────

test("gincana 3 — Maré do Pântano: o pântano sobe e quem ele alcança fica FORA (não volta)", () => {
  const C = G.COURSES.floresta;
  assert.equal(C.mode, "race");
  assert.ok(C.rise && G.riseAt(C, 0) === 0 && G.riseAt(C, 40) > G.DECK + 6, "sobe");
  // parado na largada: o pântano chega e tira da prova
  const { race, r } = solo("floresta");
  const ev = [];
  let out = false;
  while (race.t < 20 && !out) {
    race.step(undefined, ev);
    if (ev.some((e) => e.type === "out" && e.slot === 0)) out = true;
    ev.length = 0;
  }
  assert.ok(out, "ficou fora");
  assert.ok(r.out > 9 && r.out < 15, `fora aos ${r.out}`);
  for (let k = 0; k < 60 * 4; k++) race.step();
  assert.equal(r.mode, G.MODE.WATER, "não volta ao posto");
  assert.equal(race.over(), true, "a pessoa ficou fora: a prova acabou para ela");
  const st = race.standings();
  assert.equal(st[0].out >= 0, true);
  assert.equal(st[0].q, false);
});

test("gincana 3 — Maré do Pântano: cair cedo volta ao posto; cair com o posto afogado é fora", () => {
  const C = G.COURSES.floresta;
  // cai da rampa aos 5 s: volta à largada (o pântano ainda está embaixo)
  const a = solo("floresta");
  a.race.t = 5;
  Object.assign(a.r, { x: 20, z: 30, y: G.DECK + 2, ground: false });
  for (let k = 0; k < 60 * 3; k++) a.race.step();
  assert.equal(a.r.out, -1, "voltou");
  assert.ok(Math.abs(a.r.z - G.spawnAt(C, 0, 0).z) < 1);
  // cai aos 40 s com o posto 1 (9 m) já embaixo do pântano: fora
  const b = solo("floresta");
  b.race.t = 40;
  Object.assign(b.r, { x: 20, z: 90, y: 12, ground: false, cp: 1 });
  for (let k = 0; k < 60; k++) b.race.step();
  assert.ok(b.r.out >= 40, "fora");
});

test("gincana 3 — a sala vê a pessoa ficar fora pela pose (água + posto afogado)", () => {
  const server = new G.GincanaRace(3, [{ slot: 0, ctl: "remote" }, { slot: 1, ctl: "bot" }], 3, "floresta");
  while (server.t < 30) server.step();
  const p = server.pose(0);
  server.setRemote(0, { ...p, a: G.ANIM.RUN, cp: 0 });
  server.setRemote(0, { ...p, y: -1, a: G.ANIM.WATER, cp: 0 });
  assert.ok(server.runner(0).out >= 0, "fora na sala");
  assert.equal(server.pose(0).a, G.ANIM.WATER);
});
