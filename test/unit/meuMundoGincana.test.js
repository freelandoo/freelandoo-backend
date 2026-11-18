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
    // arena (Gincana 3): só o lugar de largada, com chão embaixo de todas as vagas
    if (C.mode !== "race") {
      const w = G.newWorld(C, 1, 0);
      for (let slot = 0; slot < 8; slot++) {
        const p = G.spawnAt(C, 0, slot);
        assert.equal(G.groundUnder(w, p.x, p.z, p.y + 0.5).y, p.y, `${ph} vaga ${slot}`);
      }
      continue;
    }
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

test("gincana — em todas as fases 8 computadores classificam a vaga (e a mesma semente chega igual)", () => {
  for (const ph of G.GINCANA_PHASES) {
    for (const seed of [1, 2, 3]) {
      const race = new G.GincanaRace(seed, bots(8), 3, ph);
      if (race.course.mode === "survive") {
        // só computadores: a prova acaba quando sobra a vaga em pé
        while (race.t < race.limit() && race.alive() > race.quota) race.step();
        assert.equal(race.quota, 4, ph);
        assert.ok(race.alive() <= race.quota && race.alive() > 0, `${ph} semente ${seed}: ${race.alive()} em pé`);
        assert.ok(race.t > 20, `${ph}: acabou cedo demais (${race.t})`);
        assert.equal(race.over(), true);
        const st = race.standings();
        assert.equal(st.filter((r) => r.q).length, race.alive());
        assert.ok(st.slice(race.alive()).every((r, k, a) => r.out >= 0 && (k === 0 || a[k - 1].out >= r.out)), "fora do último ao primeiro");
        continue;
      }
      if (race.course.mode === "collect" || race.course.mode === "zone") {
        // coleta vai até o tempo; classifica a metade de cima de quem pegou alguma
        while (!race.over()) race.step();
        assert.ok(Math.abs(race.t - race.limit()) < 0.1, ph);
        assert.equal(race.quota, 4, ph);
        const st = race.standings();
        assert.ok(st[0].pts >= 8, `${ph} semente ${seed}: o primeiro pegou ${st[0].pts}`);
        assert.ok(st.every((r, k) => k === 0 || st[k - 1].pts >= r.pts), "pontos em ordem");
        assert.equal(st.filter((r) => r.q).length, Math.min(race.quota, st.filter((r) => r.pts > 0).length));
        continue;
      }
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
  // nenhuma fase usa portas agora (Gincana 3): a peça é testada num percurso de teste
  const k = new G.CourseKit();
  k.box(0, 10, 9, 14, 0, 1, 1);
  k.doorRow(0, 12, 5, 3.2, 3.4, 2);
  const C = k.done({ id: "cidade", checkpoints: [{ x: 0, z: 0, y: G.DECK, w: 6 }], finishZ: 99, finishY: G.DECK, sections: [], minFinish: 1, route: () => [] });
  const w = G.newWorld(C, 3, 0);
  const r = G.newRunner(C, 0);
  const open = w.open;
  const row0 = C.doors.map((d, i) => ({ d, i })).filter((x) => x.d.row === 0);
  assert.equal(row0.filter((x) => open[x.i]).length, 2, "2 de 5 abrem");
  const race = { world: w };
  const runInto = (door) => {
    Object.assign(r, { x: door.x, z: door.z - 3, y: G.DECK, ground: true, vx: 0, vz: 0, mode: 0, cp: 0 });
    for (let s = 0; s < 90; s++) {
      w.t += G.GINCANA.step;
      G.stepRunner(r, { mx: 0, mz: 1, jump: false, dive: false }, w, null);
    }
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
  // esteira da Fábrica (Gincana 3: a Orbital virou a Varredura)
  const C = G.COURSES.fabrica;
  const belt = C.pads.find((p) => p.bz < 0);
  const { race, r } = solo("fabrica");
  // esteira FORTE (pedido do Alex): parado, 1 s leva uns 5,5 m
  Object.assign(r, { x: belt.x, z: belt.z + 4, y: belt.y, ground: true });
  const z0 = r.z;
  for (let k = 0; k < 60; k++) race.step();
  assert.ok(r.z < z0 - 4.5, `parado na esteira foi para trás: ${r.z - z0}`);
  // contra ela, correndo: anda, mas devagar (menos da metade da corrida)
  Object.assign(r, { x: belt.x, z: belt.z - 5, y: belt.y, ground: true, vx: 0, vz: 0 });
  const z1 = r.z;
  for (let k = 0; k < 60; k++) race.step({ mx: 0, mz: 1, jump: false, dive: false });
  const v = r.z - z1;
  assert.ok(v > 1 && v < G.GINCANA.run / 2, `contra a esteira: ${v} m em 1 s`);

  // vitória-régia da Maré do Pântano (Gincana 3; antes era a pedra do Cânion)
  const Cc = G.COURSES.floresta;
  const idx = Cc.pads.findIndex((p) => p.mw !== 0);
  const p = Cc.pads[idx];
  const s2 = solo("floresta");
  s2.race.t = 0;
  const sh0 = G.padShift(p, 0);
  Object.assign(s2.r, { x: p.x + sh0.dx, z: p.z, y: p.y, ground: true, pad: idx });
  for (let k = 0; k < 30; k++) s2.race.step();
  const sh1 = G.padShift(p, s2.race.t);
  assert.ok(Math.abs(s2.r.x - (p.x + sh1.dx)) < 0.3, `foi junto: ${s2.r.x} × ${p.x + sh1.dx}`);
  assert.ok(s2.r.y > p.y - 0.01);
});

test("gincana 2.0 — gelo escorrega: soltou o controle, demora a parar", () => {
  const stopAfter = (x, z, ph = "gelo") => {
    const { race, r } = solo(ph);
    Object.assign(r, { x, z, y: G.DECK, ground: true });
    for (let k = 0; k < 40; k++) race.step({ mx: 1, mz: 0, jump: false, dive: false });
    const x0 = r.x;
    for (let k = 0; k < 30; k++) race.step();
    return r.x - x0;
  };
  // iceberg (fora do topo e longe dos blocos) × largada da Cidade
  const ice = stopAfter(-4, -8);
  const normal = stopAfter(-6, 0, "cidade");
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
  for (const ph of ["cidade", "floresta"]) {
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

test("gincana 3 — Pedras que Caem: pedra pisada cai e não volta; cair do último andar é fora", () => {
  const C = G.COURSES.canion;
  assert.equal(C.mode, "survive");
  assert.ok(C.tiles.length > 600);
  const floors = [...new Set(C.tiles.map((q) => q.y))].sort((a, b) => b - a);
  assert.equal(floors.length, 4);
  const { race, r } = solo("canion");
  assert.ok(C.tiles.some((q) => G.onTile(q, r.x, r.z, 0) && q.y === floors[0]), "larga em cima de uma pedra do andar de cima");
  // parado: as pedras embaixo caem e ele cai para o andar de baixo (não atravessa)
  for (let k = 0; k < 60 * 4; k++) race.step();
  const i0 = race.world.tiles.findIndex((s, i) => s >= 0 && C.tiles[i].y === floors[0]);
  assert.ok(i0 >= 0, "pisada");
  assert.equal(G.tileUp(C, race.world.tiles[i0], race.t), false, "caiu");
  assert.ok(r.y < floors[0] - 1 && r.y >= floors[2] - 0.01, `desceu de andar: ${r.y}`);
  assert.equal(r.out, -1);
  for (let k = 0; k < 60 * 20; k++) race.step();
  assert.equal(G.tileUp(C, race.world.tiles[i0], race.t), false, "não volta");
  // fora da colmeia: cai no abismo e está fora (na sobrevivência ninguém volta)
  const s = solo("canion");
  Object.assign(s.r, { x: 40, z: 0, y: floors[0], ground: false });
  const ev = [];
  for (let k = 0; k < 60 * 3; k++) s.race.step(undefined, ev);
  assert.ok(s.r.out >= 0 && ev.some((e) => e.type === "out"), "fora");
  assert.equal(s.race.over(), true, "a única pessoa caiu: acabou");
});

test("gincana 3 — queda rápida não atravessa o chão (14 m de queda)", () => {
  const q = G.COURSES.canion.tiles.find((p) => p.y === G.DECK);
  const C = { ...G.COURSES.canion, tiles: [q] };
  const w = G.newWorld(C, 1, 0);
  const r = G.newRunner(C, 0);
  Object.assign(r, { x: q.x, z: q.z, y: G.DECK + 14, vy: 0, ground: false });
  for (let k = 0; k < 120; k++) {
    w.t += G.GINCANA.step;
    G.stepRunner(r, G.IDLE_INTENT, w, null);
  }
  assert.ok(Math.abs(r.y - G.DECK) < 0.01, `pousou: ${r.y}`);
});

test("gincana 3 — Varredura: barras aceleram; a alta derruba quem está em pé e não quem mergulha", () => {
  const C = G.COURSES.orbital;
  assert.equal(C.mode, "survive");
  const [low, high] = C.sweepers;
  assert.ok(high.y - high.r - G.DECK > 0.9 && low.y + low.r - G.DECK < 1.0, "uma baixa e uma alta");
  // acelera e o ângulo é contínuo
  assert.ok(Math.abs(G.sweeperW(low, 60)) > Math.abs(G.sweeperW(low, 0)) * 2);
  assert.equal(Math.abs(G.sweeperW(low, 500)), low.wMax);
  const a1 = G.sweeperAngle(low, 70);
  const a2 = G.sweeperAngle(low, 70 + 1e-3);
  assert.ok(Math.abs(a2 - a1) < 0.01);
  // de pé na frente da barra alta: derrubado; deslizando: passa
  const hitBy = (mode) => {
    const C2 = { ...C, sweepers: [high] };
    const w = G.newWorld(C2, 1, 0);
    const r = G.newRunner(C2, 0);
    // a barra alta (um braço) começa apontando para +x e gira para trás: espera na frente dela
    const a = G.sweeperAngle(high, 0.4);
    Object.assign(r, { x: Math.sin(a) * 6, z: Math.cos(a) * 6, y: G.DECK, ground: true, mode, timer: 5 });
    const ev = [];
    for (let k = 0; k < 30; k++) {
      w.t += G.GINCANA.step;
      G.stepRunner(r, G.IDLE_INTENT, w, ev);
      if (mode === G.MODE.SLIDE) Object.assign(r, { mode, timer: 5 });
    }
    return ev.some((e) => e.type === "hit" && e.by === "bar");
  };
  assert.equal(hitBy(G.MODE.RUN), true, "em pé leva");
  assert.equal(hitBy(G.MODE.SLIDE), false, "deslizando passa por baixo");
});

test("gincana 3 — Paredes de Brasa: a parede empurra para a lava; o vão deixa passar; a mureta se pula", () => {
  const C = G.COURSES.forja;
  assert.equal(C.mode, "survive");
  const Wl = C.walls;
  const n = Math.round((2 * Wl.hw) / Wl.seg);
  // ondas pela semente: as duas primeiras com um vão; depois dos três tipos
  const kinds = new Set();
  for (let t = Wl.t0; t < 100; t += 0.5) for (const v of G.wallsAt(C, 7, t, [])) {
    if (v.i < 2) assert.equal(v.kind, 0);
    kinds.add(v.kind);
    assert.ok(v.gaps.every((g) => g >= 0 && g < n));
  }
  assert.deepEqual([...kinds].sort(), [0, 1, 2]);
  // a primeira onda: parado longe do vão é empurrado até cair; parado no vão fica
  const first = G.wallsAt(C, 1, Wl.t0 + 0.01, [])[0];
  const gx = -Wl.hw + (first.gaps[0] + 0.5) * Wl.seg;
  const run = (x, T) => {
    const { race, r } = solo("forja");
    Object.assign(r, { x, z: 0, y: G.DECK, ground: true });
    while (race.t < T && r.out < 0) race.step();
    return r;
  };
  const solid = first.gaps[0] < n / 2 ? Wl.hw - 1.1 : -Wl.hw + 1.1;
  assert.ok(run(solid, 12).out >= 0, "empurrado para a lava");
  // até a primeira onda passar (a segunda tem outro vão)
  const ok = run(gx, Wl.t0 + (Wl.z0 + 1) / first.v);
  assert.equal(ok.out, -1, "no vão a parede passa");
});

test("gincana 3 — Caça às Engrenagens: pega, soma, some e volta; a sala conta pela pose", () => {
  const C = G.COURSES.fabrica;
  assert.equal(C.mode, "collect");
  const gold = C.gems.findIndex((g) => g.v === 3);
  assert.ok(gold >= 0 && C.gems.length >= 15);
  const { race, r } = solo("fabrica");
  const ev = [];
  const g0 = C.gems[0];
  while (race.t < g0.t0 + 0.1) race.step();
  Object.assign(r, { x: g0.x, z: g0.z, y: g0.y - 0.9, ground: true });
  race.step(undefined, ev);
  assert.ok(ev.some((e) => e.type === "gem" && e.i === 0 && e.v === 1));
  assert.equal(r.pts, 1);
  // sai de cima; some e não conta de novo até voltar
  Object.assign(r, { x: 0, z: -3.6, y: G.DECK, ground: true, vx: 0, vz: 0 });
  for (let k = 0; k < 60; k++) race.step();
  assert.equal(r.pts, 1);
  const took = race.world.gems[0];
  while (race.t < took + g0.back + 0.1) race.step();
  Object.assign(r, { x: g0.x, z: g0.z, y: g0.y - 0.9, ground: true });
  race.step();
  assert.equal(r.pts, 2, "voltou e pegou de novo");
  // a sala: pessoa pela rede pega a dourada
  // (um computador pode chegar antes na dourada: a pessoa entra num ponto em que ela está de pé)
  const server = new G.GincanaRace(5, [{ slot: 0, ctl: "remote" }, { slot: 1, ctl: "remote" }], 0, "fabrica");
  const gg = C.gems[gold];
  while (server.t < gg.t0 + 0.1) server.step();
  server.setRemote(0, { x: gg.x, y: gg.y - 0.9, z: gg.z, f: 0, a: G.ANIM.IDLE, cp: 0, fin: -1, g: -1 });
  server.step();
  assert.equal(server.runner(0).pts, 3);
  assert.equal(server.over(), false, "coleta vai até o tempo");
  while (server.t < C.limit) server.step();
  assert.equal(server.over(), true);
  const st = server.standings();
  assert.equal(st[0].slot, 0);
  assert.ok(st[0].q && !st[1].q, "quem não pegou nenhuma não classifica");
  assert.equal(st.filter((x) => x.q).length <= server.quota, true);
});

test("gincana 3 — Rei do Iceberg: ponto por segundo só em pé no topo; a sala conta pela pose", () => {
  const C = G.COURSES.gelo;
  assert.equal(C.mode, "zone");
  const Z = C.zone;
  const { race, r } = solo("gelo");
  while (race.t < 1) race.step();
  // embaixo, fora do anel: nada
  Object.assign(r, { x: 0, z: -9, y: G.DECK, ground: true });
  for (let k = 0; k < 60; k++) race.step();
  assert.equal(r.pts, 0);
  // no topo: soma ~1 por segundo
  // do lado oposto à barra (ela leva uns 5 s para chegar)
  const a = G.sweeperAngle(C.sweepers[0], race.t) + Math.PI;
  Object.assign(r, { x: Math.sin(a) * 2.2, z: Math.cos(a) * 2.2, y: Z.y, ground: true, vx: 0, vz: 0, mode: 0 });
  const p0 = r.pts;
  for (let k = 0; k < 60; k++) race.step();
  assert.ok(r.pts - p0 > 0.9 && r.pts - p0 < 1.05, `somou ${r.pts - p0}`);
  // a sala: pose no topo soma; pose na água não
  const server = new G.GincanaRace(5, [{ slot: 0, ctl: "remote" }, { slot: 1, ctl: "remote" }], 0, "gelo");
  while (server.t < 1) server.step();
  for (let k = 0; k < 120; k++) {
    server.setRemote(0, { x: 1, y: Z.y, z: 1, f: 0, a: G.ANIM.IDLE, cp: 0, fin: -1, g: -1 });
    server.setRemote(1, { x: 0, y: G.DECK - 2, z: 13, f: 0, a: G.ANIM.WATER, cp: 0, fin: -1, g: -1 });
    server.step();
  }
  assert.ok(Math.abs(server.runner(0).pts - 2) < 0.05, String(server.runner(0).pts));
  assert.equal(server.runner(1).pts, 0);
  assert.equal(server.runner(1).out, -1, "no mar não fica fora");
  while (!server.over()) server.step();
  assert.ok(Math.abs(server.t - C.limit) < 0.1);
  const st = server.standings();
  assert.ok(st[0].slot === 0 && st[0].q && !st[1].q);
});
