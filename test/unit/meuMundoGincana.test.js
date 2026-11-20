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

test("gincana — 22 fases; cada uma fecha: postos em ordem com chão, chegada no alto da subida", () => {
  assert.deepEqual([...G.GINCANA_PHASES], ["cidade", "floresta", "clareira", "serraria", "canion", "moinhos", "gangorras", "orbital", "helices", "forja", "altoforno", "crosta", "fabrica", "comportas", "tanque", "gelo", "portoes", "estaleiro", "aros", "relogio", "feira", "coroa"]);
  for (const ph of G.GINCANA_PHASES) {
    const C = G.COURSES[ph];
    assert.equal(C.id, ph);
    // arena (Gincana 3): só o lugar de largada, com chão embaixo de todas as vagas
    if (C.mode !== "race") {
      const w = G.newWorld(C, 1, 0);
      for (let slot = 0; slot < 8; slot++) {
        const p = G.spawnAt(C, 0, slot);
        // no cilindro (Rolo de Gelo) a vaga de lado fica um pouco acima da curva: cai até 0,6 m
        const gy = G.groundUnder(w, p.x, p.z, p.y + 0.5).y;
        assert.ok(gy <= p.y + 1e-9 && gy > p.y - (C.drums.length ? 0.6 : 1e-9), `${ph} vaga ${slot}: ${gy}`);
      }
      continue;
    }
    for (let i = 1; i < C.checkpoints.length; i++) assert.ok(C.checkpoints[i].z > C.checkpoints[i - 1].z, `${ph} posto ${i}`);
    assert.ok(C.finishZ > C.checkpoints[C.checkpoints.length - 1].z + 30, ph);
    // chegada no alto da ÚLTIMA subida (a Maré do Pântano tem várias)
    const ramps = C.pads.filter((p) => p.k === 2);
    // na Coroa da Torre a linha fica 1,1 m acima do estrado (só pulando)
    assert.equal(C.finishY, ramps[ramps.length - 1].y2 + (C.crown ? 1.1 : 0), ph);
    assert.equal(C.sections.length, 5, ph);
    const w = G.newWorld(C, 1, 0);
    for (let cp = 0; cp < C.checkpoints.length; cp++) {
      for (let slot = 0; slot < 8; slot++) {
        const p = G.spawnAt(C, cp, slot);
        assert.equal(G.groundUnder(w, p.x, p.z, p.y + 0.5).y, p.y, `${ph} posto ${cp} vaga ${slot}`);
      }
    }
  }
  // a da cidade (G3-11): Portas da Prefeitura — 5 fileiras de 5 portas, carrossel de duas barras, pêndulos
  assert.equal(C0.doors.length, 25);
  assert.deepEqual(C0.doorOpen, [3, 2, 2, 2, 2]);
  assert.ok(C0.sweepers.length >= 1 && C0.pendulums.length >= 6 && C0.balls);
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
        // acabou o tempo com mais gente em pé: todos os de pé classificam (como no gênero)
        assert.ok((race.alive() <= race.quota || race.t >= race.limit()) && race.alive() > 0, `${ph} semente ${seed}: ${race.alive()} em pé`);
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
      // a final (Coroa da Torre) tem vaga 1
      const q = race.course.qualify < 0.5 ? 1 : 6;
      assert.equal(race.quota, q, ph);
      assert.equal(race.order.length, q, `${ph} semente ${seed}: ${race.order.length} classificados`);
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
  // a cidade não tem mais xadrez (G3-11): a peça é testada num percurso de teste (corrida, com posto)
  const k = new G.CourseKit();
  k.box(0, 0, 6, 4, 0, 1, 0);
  for (let i = 0; i < 9; i++) k.tile(((i % 3) - 1) * 2.9, 7 + Math.floor(i / 3) * 2.9, 1.3, 2);
  const CT = k.done({ id: "cidade", checkpoints: [{ x: 0, z: -1, y: G.DECK, w: 5 }, { x: 0, z: 1.5, y: G.DECK, w: 5 }], finishZ: 99, finishY: G.DECK, sections: [], minFinish: 1, route: () => [] });
  const w = G.newWorld(CT, 1, 0);
  const r = G.newRunner(CT, 0);
  const tile = CT.tiles[4];
  Object.assign(r, { x: tile.x, z: tile.z, y: G.DECK + 0.01, ground: false, cp: 1 });
  const ev = [];
  const step = () => {
    w.t += G.GINCANA.step;
    for (let i = 0; i < w.tiles.length; i++) if (w.tiles[i] >= 0 && w.t - w.tiles[i] >= CT.tileTime.warn + CT.tileTime.gone) w.tiles[i] = -1;
    G.stepRunner(r, G.IDLE_INTENT, w, ev);
  };
  let stepped = false;
  for (let s = 0; s < 20 && !stepped; s++) {
    step();
    stepped = ev.some((e) => e.type === "tile" && e.i === 4);
    ev.length = 0;
  }
  assert.ok(stepped, "pisou");
  const at = w.tiles[4];
  assert.ok(G.tileUp(CT, at, at + CT.tileTime.warn * 0.5), "ainda treme em pé");
  assert.equal(G.tileUp(CT, at, at + CT.tileTime.warn + 0.1), false, "caiu");
  let splash = false;
  let back = false;
  for (let s = 0; s < 60 * 4; s++) {
    step();
    if (ev.some((e) => e.type === "splash")) splash = true;
    if (ev.some((e) => e.type === "back")) back = true;
    ev.length = 0;
  }
  assert.ok(splash && back);
  assert.ok(Math.abs(r.z - G.spawnAt(CT, 1, 0).z) < 1, `voltou ao posto: z ${r.z}`);
  for (let s = 0; s < 60 * 5; s++) step();
  assert.equal(w.tiles[4], -1, "o ladrilho voltou");
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
  // piso de teste com atrito de gelo (nenhuma fase usa mais o lago de gelo) × piso normal
  const stopAfter = (f) => {
    const k = new G.CourseKit();
    const p = k.box(0, 0, 20, 20, 0, 1, 1);
    k.pads[p].f = f;
    const C = k.done({ id: "cidade", checkpoints: [{ x: 0, z: 0, y: G.DECK, w: 6 }], finishZ: 99, finishY: G.DECK, sections: [], minFinish: 1, route: () => [] });
    const w = G.newWorld(C, 1, 0);
    const r = G.newRunner(C, 0);
    Object.assign(r, { x: -10, z: 0, y: G.DECK, ground: true });
    const go = (mx, n) => {
      for (let s = 0; s < n; s++) {
        w.t += G.GINCANA.step;
        G.stepRunner(r, { mx, mz: 0, jump: false, dive: false }, w, null);
      }
    };
    go(1, 40);
    const x0 = r.x;
    go(0, 30);
    return r.x - x0;
  };
  const ice = stopAfter(0.3);
  const normal = stopAfter(1);
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

test("gincana 3 — Rolo de Gelo: buraco passa e derruba (fora); o chão anda de lado; a sala vê a queda", () => {
  const C = G.COURSES.gelo;
  assert.equal(C.mode, "survive");
  const d = C.drums[0];
  assert.ok(d && d.rings.length >= 5);
  // o topo do anel tem chão a maior parte do tempo e buraco às vezes
  let holes = 0;
  for (let t = 0; t < 60; t += 0.25) if (!G.drumAt(d, 0, 2.5, t)) holes++;
  assert.ok(holes > 4 && holes < 120, `buracos no topo: ${holes}`);
  // parado no topo do anel 0: o chão leva para o lado
  const { race, r } = solo("gelo");
  while (race.t < 2) race.step();
  let t1 = race.t;
  while (!G.drumAt(d, 0, 2.5, t1) || !G.drumAt(d, 0, 2.5, t1 + 1.2)) t1 += 0.1;
  while (race.t < t1) race.step();
  Object.assign(r, { x: 0, z: 2.5, y: G.ROLL_TOP, ground: true, vx: 0, vz: 0, mode: 0 });
  race.step();
  const x0 = r.x;
  for (let k = 0; k < 40; k++) race.step();
  assert.ok(Math.sign(r.x - x0) === Math.sign(d.rings[0].w) && Math.abs(r.x - x0) > 0.8, `arrastou ${r.x - x0}`);
  // em cima do buraco: cai e fica fora
  let t2 = race.t;
  while (G.drumAt(d, 0, 7.5, t2)) t2 += 0.05;
  while (race.t < t2 - 0.02) race.step();
  Object.assign(r, { x: 0, z: 7.5, y: G.ROLL_TOP, ground: true, vx: 0, vz: 0, mode: 0 });
  for (let k = 0; k < 150 && r.out < 0; k++) race.step();
  assert.ok(r.out >= 0, "caiu no buraco e ficou fora");
  // a sala: pose na água = fora
  const server = new G.GincanaRace(5, [{ slot: 0, ctl: "remote" }, { slot: 1, ctl: "remote" }], 0, "gelo");
  while (server.t < 3) server.step();
  server.setRemote(1, { x: 0, y: -2, z: 9, f: 0, a: G.ANIM.WATER, cp: 0, fin: -1, g: -1 });
  server.step();
  assert.ok(server.runner(1).out >= 0);
  assert.equal(server.alive(), 1);
});

test("gincana 3 — Relógio da Praça: símbolos pela semente, só os do chamado ficam; quem está no errado cai e sai", () => {
  const C = G.COURSES.relogio;
  assert.equal(C.mode, "survive");
  const M = C.memory;
  assert.ok(M && M.n === 5);
  // cada símbolo em 4–5 ladrilhos; a mesma semente dá a mesma grade, outra rodada embaralha
  const a = G.memSymbols(M, 77, 0);
  for (let s = 0; s < G.MEM_SYMBOLS; s++) {
    const n = a.filter((x) => x === s).length;
    assert.ok(n >= 4 && n <= 5, `símbolo ${s}: ${n}`);
  }
  assert.deepEqual([...G.memSymbols(M, 77, 0)], [...a]);
  assert.notDeepEqual([...G.memSymbols(M, 77, 1)], [...a]);
  // as fases da rodada em ordem, e as rodadas encurtam
  const seen = [];
  for (let t = 0; t < 14; t += 0.05) {
    const st = G.memState(M, t);
    if (st.r === 0 && seen[seen.length - 1] !== st.ph) seen.push(st.ph);
  }
  assert.deepEqual(seen, [0, 1, 2, 3, 4, 5]);
  assert.ok(G.memShow(6) < G.memShow(0) && G.memCall(6) < G.memCall(0));
  // na queda: de pé = exatamente os do símbolo chamado
  const { race, r } = solo("relogio", 9);
  const seed = race.world.seed;
  let td = 0;
  while (G.memState(M, td).ph !== 4) td += 0.05;
  const st = G.memState(M, td + 0.1);
  const sym = G.memSymbols(M, seed, st.r);
  const tg = G.memTarget(seed, st.r);
  for (let i = 0; i < 25; i++) assert.equal(G.memUp(M, seed, i, td + 0.1), sym[i] === tg, `ladrilho ${i}`);
  for (let i = 0; i < 25; i++) assert.equal(G.memUp(M, seed, i, td - 0.1), true);
  // parado no certo: fica; parado no errado: cai e está fora
  const good = [...sym].findIndex((x) => x === tg);
  const bad = [...sym].findIndex((x) => x !== tg);
  while (race.t < td - 0.3) race.step();
  const gq = G.memTile(M, good);
  Object.assign(r, { x: gq.x, z: gq.z, y: M.y, ground: true, vx: 0, vz: 0, mode: 0 });
  while (race.t < td + 1) race.step();
  assert.ok(r.out < 0 && Math.abs(r.y - M.y) < 0.05, "no certo fica de pé");
  const bq = G.memTile(M, bad);
  Object.assign(r, { x: bq.x, z: bq.z, y: M.y, ground: true, vx: 0, vz: 0, mode: 0 });
  for (let k = 0; k < 200 && r.out < 0; k++) race.step();
  assert.ok(r.out >= 0, "no errado cai e sai");
  // a sala: pose na água = fora
  const server = new G.GincanaRace(5, [{ slot: 0, ctl: "remote" }, { slot: 1, ctl: "remote" }], 0, "relogio");
  while (server.t < 3) server.step();
  server.setRemote(1, { x: 0, y: -2, z: 0, f: 0, a: G.ANIM.WATER, cp: 0, fin: -1, g: -1 });
  server.step();
  assert.ok(server.runner(1).out >= 0);
  assert.equal(server.alive(), 1);
});

test("gincana 3 — Coroa da Torre: final de vaga 1; passar pelo chão não pega a coroa, pular pega e fecha a prova", () => {
  const C = G.COURSES.coroa;
  assert.equal(C.crown, true);
  assert.equal(C.mode, "race");
  const race = new G.GincanaRace(3, [{ slot: 0, ctl: "local" }, ...[1, 2, 3, 4, 5, 6, 7].map((slot) => ({ slot, ctl: "remote" }))], 0, "coroa");
  assert.equal(race.quota, 1);
  const r = race.runner(0);
  const top = C.finishY - 1.1;
  // correndo pelo chão do estrado: cruza a linha sem pegar
  Object.assign(r, { x: 0, z: C.finishZ - 2, y: top, ground: true, vx: 0, vz: 0, mode: 0, cp: 4 });
  for (let k = 0; k < 30; k++) race.step({ mx: 0, mz: 1, jump: false, dive: false });
  assert.ok(r.z > C.finishZ && r.fin < 0, "no chão não pega a coroa");
  // pulando antes da linha: pega e a prova fecha
  Object.assign(r, { x: 0, z: C.finishZ - 1.2, y: top, ground: true, vx: 0, vz: 0, mode: 0 });
  race.step({ mx: 0, mz: 1, jump: true, dive: false });
  for (let k = 0; k < 40 && r.fin < 0; k++) race.step({ mx: 0, mz: 1, jump: false, dive: false });
  assert.ok(r.fin >= 0, "pulou e pegou a coroa");
  assert.equal(race.closed(), true);
  assert.equal(race.standings().filter((x) => x.q).length, 1);
});

// ── Comportas da Usina (2026-11-20) ──────────────────────────────────────────
test("gincana — Comportas: a comporta sobe e desce pelo relógio, leva quem está em cima e barra quem chega; a graxa deixa lento", () => {
  const C = G.COURSES.comportas;
  assert.equal(C.mode, "race");
  const gates = C.pads.filter((p) => p.gh > 0);
  assert.ok(gates.length >= 20, `${gates.length} comportas`);
  const p = gates.find((q) => q.z === 26 && q.x === 0);
  // ciclo: embaixo, sobe, em cima, desce
  const tAt = (u) => ((u * p.gp - p.gph) % p.gp + p.gp * 4) % p.gp + p.gp * 2;
  assert.equal(G.gateLift(p, tAt(0.2)), 0);
  assert.equal(G.gateLift(p, tAt(0.7)), 1);
  assert.equal(G.padTop(p, p.z, tAt(0.7)), p.y + p.gh);
  const at = (x, z, t0, steps, mz) => {
    const { race, r } = solo("comportas");
    while (race.t < t0) race.step({ mx: 0, mz: 0, jump: false, dive: false }, []);
    Object.assign(r, { x, z, y: G.DECK, vx: 0, vy: 0, vz: 0, ground: true });
    let maxY = r.y;
    for (let k = 0; k < steps; k++) {
      race.step({ mx: 0, mz, jump: false, dive: false }, []);
      maxY = Math.max(maxY, r.y);
    }
    return { r, maxY };
  };
  // em cima quando ela sobe: vai junto até o alto
  assert.ok(Math.abs(at(p.x, p.z, tAt(0.3), 60).maxY - (G.DECK + p.gh)) < 1e-6, "subiu junto");
  // chegando com ela em cima: fica parado na frente
  const blocked = at(p.x, p.z - p.hz - 1.5, tAt(0.55), 30, 1).r;
  assert.ok(blocked.z < p.z - p.hz, `barrou em ${blocked.z}`);
  // graxa: corrida na metade
  const gr = C.pads.find((q) => q.sl < 1);
  assert.equal(gr.sl, 0.5);
  const run = (z) => {
    const { race, r } = solo("comportas");
    while (race.t < 0.5) race.step({ mx: 0, mz: 0, jump: false, dive: false }, []);
    Object.assign(r, { x: z > 130 ? -9 : -5.5, z, y: G.DECK, vx: 0, vy: 0, vz: 0, ground: true });
    const z0 = r.z;
    for (let k = 0; k < 60; k++) race.step({ mx: 0, mz: 1, jump: false, dive: false }, []);
    return r.z - z0;
  };
  const dry = run(116);
  const wet = run(137);
  assert.ok(wet < dry * 0.62 && wet > dry * 0.4, `graxa ${wet.toFixed(2)} × seco ${dry.toFixed(2)}`);
});

// ── Portões de Gelo (2026-11-20) ─────────────────────────────────────────────
test("gincana — Portões de Gelo: fileiras que estreitam, o portão de verdade deixa passar e o falso barra; o gelo escorrega", () => {
  const C = G.COURSES.portoes;
  assert.equal(C.mode, "race");
  const rows = [...new Set(C.doors.map((d) => d.row))];
  assert.equal(rows.length, 9);
  let prev = Infinity;
  for (const row of rows) {
    const ds = C.doors.filter((d) => d.row === row);
    assert.ok(ds.length <= prev, `fileira ${row} não estreita`);
    prev = ds.length;
    const open = C.doorOpen[row];
    assert.ok(open >= 1 && open < ds.length, `fileira ${row}: ${open} de ${ds.length}`);
    // a fileira fecha o deck de ponta a ponta
    const x0 = ds[0].x - ds[0].hw;
    const x1 = ds[ds.length - 1].x + ds[ds.length - 1].hw;
    const deck = C.pads.find((p) => p.k === 1 && Math.abs(p.z - ds[0].z) <= p.hz && p.y === G.DECK && p.hx >= 4);
    assert.ok(deck && Math.abs(x1 - x0 - deck.hx * 2) < 1e-6, `fileira ${row} não fecha o deck`);
  }
  // atravessa o de verdade, bate no falso
  const tryDoor = (want) => {
    const { race, r } = solo("portoes");
    while (race.t < 0.5) race.step({ mx: 0, mz: 0, jump: false, dive: false }, []);
    const i = C.doors.findIndex((d, k) => d.row === 0 && !!race.world.open[k] === want);
    const d = C.doors[i];
    Object.assign(r, { x: d.x, z: d.z - 2, y: G.DECK, vx: 0, vy: 0, vz: 0, ground: true });
    for (let k = 0; k < 60; k++) race.step({ mx: 0, mz: 1, jump: false, dive: false }, []);
    return { r, d };
  };
  const real = tryDoor(true);
  assert.ok(real.r.z > real.d.z + 1, `passou: ${real.r.z}`);
  const fake = tryDoor(false);
  assert.ok(fake.r.z < fake.d.z, `barrou: ${fake.r.z}`);
  // gelo: solta o comando correndo e escorrega mais longe que no chão seco
  const slide = (z) => {
    const { race, r } = solo("portoes");
    while (race.t < 0.5) race.step({ mx: 0, mz: 0, jump: false, dive: false }, []);
    Object.assign(r, { x: -2, z, y: G.DECK, vx: 0, vy: 0, vz: 0, ground: true });
    for (let k = 0; k < 40; k++) race.step({ mx: 0, mz: 1, jump: false, dive: false }, []);
    const z0 = r.z;
    for (let k = 0; k < 40; k++) race.step({ mx: 0, mz: 0, jump: false, dive: false }, []);
    return r.z - z0;
  };
  const ice = C.pads.filter((p) => p.f < 1);
  assert.equal(ice.length, 2);
  const dry = slide(48);
  const wet = slide(62);
  assert.ok(wet > dry * 1.5, `gelo ${wet.toFixed(2)} × seco ${dry.toFixed(2)}`);
});

// ── Esteira do Alto-Forno (2026-11-20) ───────────────────────────────────────
test("gincana — Alto-Forno: a esteira puxa para trás e as bolas quicam e vão de lado", () => {
  const C = G.COURSES.altoforno;
  assert.equal(C.mode, "race");
  const ramp = C.pads.find((p) => p.k === 2 && p.bz < 0 && p.z === (C.ramp.z0 + C.ramp.z1) / 2);
  assert.ok(ramp, "a 1ª rampa é a esteira");
  // parado na esteira: desce
  const { race, r } = solo("altoforno");
  while (race.t < 0.5) race.step({ mx: 0, mz: 0, jump: false, dive: false }, []);
  Object.assign(r, { x: 0, z: 80, y: G.rampTop(C, 80), vx: 0, vy: 0, vz: 0, ground: true });
  const z0 = r.z;
  for (let k = 0; k < 30; k++) race.step({ mx: 0, mz: 0, jump: false, dive: false }, []);
  assert.ok(r.z < z0 - 0.5, `esteira levou ${(z0 - r.z).toFixed(2)} m`);
  // as bolas: alturas acima do tampo variam (quique) e o x sai da faixa (lado)
  const out = [];
  let up = 0;
  let side = 0;
  let n = 0;
  for (let t = 5; t < 25; t += 0.05) {
    G.ballsAt(C, 3, t, out);
    for (let k = 0; k < out.length; k += 5) {
      if (out[k + 2] < C.ramp.z0) continue;
      n++;
      const lift = out[k + 1] - (G.rampTop(C, out[k + 2]) + C.balls.R);
      assert.ok(lift >= -1e-9 && lift <= C.balls.hop + 1e-9, `quique fora: ${lift}`);
      if (lift > 1) up++;
      if (Math.abs(out[k] - C.ramp.x - C.balls.lanes[out[k + 3]]) > 0.3) side++;
    }
  }
  assert.ok(n > 100 && up > n * 0.2 && side > n * 0.3, `bolas ${n}, no alto ${up}, de lado ${side}`);
});

// ── Trilha dos Moinhos (2026-11-20) ──────────────────────────────────────────
test("gincana — Moinhos: a moenda é parede de lado e joga quem está em cima; catavento tem mastro", () => {
  const C = G.COURSES.moinhos;
  assert.equal(C.mode, "race");
  assert.equal(C.drums.length, 7);
  assert.ok(C.drums.every((d) => d.wall), "as moendas são parede");
  // encostado na lateral da moenda, abaixo do eixo: é empurrado para fora (não atravessa)
  const d = C.drums[1];
  const { race, r } = solo("moinhos");
  while (race.t < 0.5) race.step({ mx: 0, mz: 0, jump: false, dive: false }, []);
  Object.assign(r, { x: d.x + d.R * 0.5, z: d.z0 + 7, y: G.DECK, vx: 0, vy: 0, vz: 0, ground: true });
  race.step({ mx: -1, mz: 0, jump: false, dive: false }, []);
  assert.ok(Math.abs(r.x - d.x) >= d.R * G.DRUM_EDGE - 1e-6, `atravessou a moenda: ${(r.x - d.x).toFixed(2)}`);
  // em cima da moenda: o giro leva de lado
  Object.assign(r, { x: d.x, z: d.z0 + 7, y: d.y + d.R, vx: 0, vy: 0, vz: 0, ground: true });
  const x0 = r.x;
  for (let k = 0; k < 20; k++) race.step({ mx: 0, mz: 0, jump: false, dive: false }, []);
  assert.ok(Math.abs(r.x - x0) > 0.3, `a moenda não jogou: ${(r.x - x0).toFixed(2)}`);
  // cada catavento gira em volta de um mastro (poste)
  const vanes = C.sweepers.filter((sw) => sw.len < 3);
  assert.equal(vanes.length, 9);
  for (const v of vanes) assert.ok(C.posts.some((q) => q.x === v.x && q.z === v.z), "catavento sem mastro");
});

// ── Hélices da Orbital (2026-11-20) ──────────────────────────────────────────
test("gincana — Hélices: as pás giram juntas em volta do cubo e levam quem está em cima; hélice com barra tem a turbina", () => {
  const C = G.COURSES.helices;
  assert.equal(C.mode, "race");
  const fans = G.HELICES.fans;
  assert.equal(fans.length, 5);
  for (const [x, z, n, , , w, bar] of fans) {
    const blades = C.pads.filter((p) => p.k === 1 && p.x === x && p.z === z && p.spin === w);
    assert.equal(blades.length, n, `hélice em z ${z}: ${blades.length} pás`);
    assert.ok(C.pads.some((p) => p.k === 0 && p.x === x && p.z === z && p.spin === w), "hélice sem o cubo");
    if (bar) {
      assert.ok(C.posts.some((q) => q.x === x && q.z === z), "hélice com barra sem a turbina");
      assert.ok(C.sweepers.some((sw) => sw.x === x && sw.z === z && Math.sign(sw.w) === -Math.sign(w)), "a barra gira ao contrário");
    }
  }
  // em pé na ponta de uma pá, parado: o giro leva de lado
  const [x, z, , L] = fans[0];
  const { race, r } = solo("helices");
  while (race.t < 0.5) race.step({ mx: 0, mz: 0, jump: false, dive: false }, []);
  const blade = C.pads.find((p) => p.k === 1 && p.x === x && p.z === z);
  const a = G.padRot(blade, race.t);
  const px = x + Math.sin(a) * (L - 1.5);
  const pz = z + Math.cos(a) * (L - 1.5);
  Object.assign(r, { x: px, z: pz, y: G.DECK, vx: 0, vy: 0, vz: 0, ground: true });
  for (let k = 0; k < 20; k++) race.step({ mx: 0, mz: 0, jump: false, dive: false }, []);
  assert.ok(r.y > G.DECK - 0.5, "caiu da pá");
  assert.ok(Math.hypot(r.x - px, r.z - pz) > 0.8, `a pá não levou: ${Math.hypot(r.x - px, r.z - pz).toFixed(2)}`);
});

// ── Serraria da Lua (2026-11-20) ─────────────────────────────────────────────
test("gincana — Serraria: a tora é parede embaixo, rola contra e o cravo derruba; a tábua inclina e escorrega", () => {
  const C = G.COURSES.serraria;
  assert.equal(C.mode, "race");
  assert.equal(C.logs.length, 6);
  assert.equal(C.planks.length, 10);
  assert.equal(C.pendulums.length, 5);
  const L = C.logs[0];
  const { race, r } = solo("serraria");
  while (race.t < 0.5) race.step({ mx: 0, mz: 0, jump: false, dive: false }, []);
  // de frente, no pé da tora: não atravessa
  Object.assign(r, { x: L.x, z: L.z - L.R - 0.2, y: G.DECK, vx: 0, vy: 0, vz: 0, ground: true });
  for (let k = 0; k < 10; k++) race.step({ mx: 0, mz: 1, jump: false, dive: false }, []);
  assert.ok(r.z <= L.z - L.R * G.LOG_EDGE + 0.05 || r.y > G.DECK + 0.5, `atravessou a tora: z ${(r.z - L.z).toFixed(2)}`);
  // no topo, longe dos cravos: o giro leva para trás (−z)
  const t0 = race.t;
  let safe = 0;
  for (let k = 0; k < L.rows; k++) {
    const a = G.logRowAngle(L, k, t0);
    safe = Math.max(safe, Math.cos(a));
  }
  const gapX = L.x - L.hx + L.pitch * 0.5 + L.pitch * 0.5; // entre o 1º cravo da fileira par e o da ímpar
  Object.assign(r, { x: gapX + 0.01, z: L.z, y: L.y + L.R, vx: 0, vy: 0, vz: 0, ground: true, mode: 0, timer: 0, shield: 5 });
  const z0 = r.z;
  for (let k = 0; k < 12; k++) race.step({ mx: 0, mz: 0, jump: false, dive: false }, []);
  assert.ok(r.z < z0 - 0.2, `a tora não levou para trás: ${(r.z - z0).toFixed(2)}`);
  // o cravo derruba quem está na frente dele
  const out = [];
  let hit = false;
  for (let s = 0; s < 400 && !hit; s++) {
    Object.assign(r, { x: G.logSpikeX(L, 0, 1), z: L.z, y: L.y + L.R, vx: 0, vy: 0, vz: 0, ground: true, mode: 0, timer: 0, shield: 0, hitCool: 0 });
    race.step({ mx: 0, mz: 0, jump: false, dive: false }, out);
    hit = out.some((e) => e.type === "hit");
  }
  assert.ok(hit, "o cravo não derrubou");
  // tábua inclinada: escorrega para o lado que desce
  const Pk = C.planks[0];
  let tt = race.t;
  while (Math.abs(G.plankAngle(Pk, tt)) < Pk.amp * 0.8) {
    race.step({ mx: 0, mz: 0, jump: false, dive: false }, []);
    tt = race.t;
  }
  const sg = Math.sign(G.plankAngle(Pk, race.t));
  Object.assign(r, { x: Pk.x, z: Pk.z, y: G.plankTop(Pk, Pk.x, race.t), vx: 0, vy: 0, vz: 0, ground: true, mode: 0, timer: 0, shield: 5 });
  for (let k = 0; k < 8; k++) race.step({ mx: 0, mz: 0, jump: false, dive: false }, []);
  assert.ok((r.x - Pk.x) * sg < -0.1, `a tábua não escorregou: ${(r.x - Pk.x).toFixed(2)}`);
});

// ── Trilha da Crosta (2026-11-20) ────────────────────────────────────────────
test("gincana — Crosta: o caminho escondido é contínuo; a placa firme acende e fica, a falsa cai e não volta", () => {
  const C = G.COURSES.crosta;
  assert.equal(C.mode, "race");
  assert.equal(C.tiles.length, G.CROSTA.grids.reduce((n, g) => n + g[2] * g[3], 0));
  for (const seed of [1, 2, 3, 4, 5]) {
    const real = G.pathReal(C, seed);
    assert.deepEqual([...real], [...G.pathReal(C, seed)], "a mesma semente dá o mesmo caminho");
    G.CROSTA.grids.forEach((grid, g) => {
      const [, , cols, rows] = grid;
      const cell = (r, c) => C.tiles.findIndex((q) => q.pg === g && q.pr === r && q.pc === c);
      // da 1ª à última fileira dá para ir só reto ou de lado, só em placa de verdade
      const seen = new Set();
      const stack = [];
      for (let c = 0; c < cols; c++) if (real[cell(0, c)]) stack.push([0, c]);
      let reached = false;
      while (stack.length) {
        const [r, c] = stack.pop();
        const k = r * cols + c;
        if (seen.has(k)) continue;
        seen.add(k);
        if (r === rows - 1) reached = true;
        for (const [dr, dc] of [[1, 0], [0, 1], [0, -1]]) {
          const r2 = r + dr;
          const c2 = c + dc;
          if (r2 < rows && c2 >= 0 && c2 < cols && real[cell(r2, c2)]) stack.push([r2, c2]);
        }
      }
      assert.ok(reached, `semente ${seed}, tabuleiro ${g}: o caminho não chega ao fim`);
      for (let r = 0; r < rows; r++) assert.ok([...Array(cols).keys()].some((c) => real[cell(r, c)]), "fileira sem placa firme");
    });
  }
  // pisar: a firme acende (−2) e segura; a falsa cai depois do aviso e não volta
  const { race, r } = solo("crosta");
  while (race.t < 0.5) race.step({ mx: 0, mz: 0, jump: false, dive: false }, []);
  const w = race.world;
  const good = C.tiles.findIndex((q, i) => q.pg === 0 && q.pr === 0 && w.real[i]);
  const bad = C.tiles.findIndex((q, i) => q.pg === 0 && q.pr === 0 && !w.real[i]);
  const g0 = C.tiles[good];
  Object.assign(r, { x: g0.x, z: g0.z, y: G.DECK + 0.05, vx: 0, vy: 0, vz: 0, ground: false });
  for (let k = 0; k < 30; k++) race.step({ mx: 0, mz: 0, jump: false, dive: false }, []);
  assert.equal(w.tiles[good], -2, "a firme não acendeu");
  assert.ok(Math.abs(r.y - G.DECK) < 0.2, "caiu da firme");
  const b0 = C.tiles[bad];
  Object.assign(r, { x: b0.x, z: b0.z, y: G.DECK + 0.05, vx: 0, vy: 0, vz: 0, ground: false });
  for (let k = 0; k < 6; k++) race.step({ mx: 0, mz: 0, jump: false, dive: false }, []);
  assert.ok(w.tiles[bad] >= 0, "a falsa não registrou o pisão");
  for (let k = 0; k < 120; k++) race.step({ mx: 0, mz: 0, jump: false, dive: false }, []);
  assert.ok(!G.tileUp(C, w.tiles[bad], race.t), "a falsa não caiu");
  assert.ok(r.y < G.DECK - 1 || r.z < 0, "quem estava na falsa não caiu");
  for (let k = 0; k < 600; k++) race.step({ mx: 0, mz: 0, jump: false, dive: false }, []);
  assert.ok(!G.tileUp(C, w.tiles[bad], race.t), "a falsa voltou");
  assert.equal(w.tiles[good], -2, "a firme apagou");
});

// ── Tanque de Óleo (2026-11-20) ──────────────────────────────────────────────
test("gincana — Tanque: o óleo sobe e tira da prova; as rampas trocam de lado; o pistão joga para fora", () => {
  const C = G.COURSES.tanque;
  assert.equal(C.mode, "race");
  assert.ok(C.rise && C.rise.y1 > C.finishY, "o óleo passa do topo");
  // zigue-zague: as três primeiras rampas alternam o lado
  const ramps = C.pads.filter((p) => p.k === 2).sort((a, b) => a.z - b.z);
  assert.equal(ramps.length, 4);
  assert.ok(ramps[0].x < 0 && ramps[1].x > 0 && ramps[2].x < 0 && ramps[3].x === 0, "rampas fora de ordem");
  assert.ok(ramps.every((p, i) => i === 0 || p.y >= ramps[i - 1].y2 - 0.01), "cada rampa começa no alto da anterior");
  assert.equal(C.gloves.length, 5);
  assert.equal(C.pushers.length, 5);
  assert.equal(C.pendulums.length, 4);
  // quem fica parado na largada é pego pelo óleo e está fora
  const { race, r } = solo("tanque");
  let t = 0;
  while (r.out < 0 && race.t < 40) race.step({ mx: 0, mz: 0, jump: false, dive: false }, []), (t = race.t);
  assert.ok(r.out >= 0, "o óleo não tirou ninguém");
  assert.ok(t > 6 && t < 20, `saiu na hora errada: ${t.toFixed(1)}`);
  // o pistão da rampa 3 empurra para +x (para fora da parede)
  const g = C.gloves.find((q) => q.dir > 0);
  const { race: r2, r: b } = solo("tanque");
  const out = [];
  let hit = false;
  for (let s = 0; s < 400 && !hit; s++) {
    const q = G.gloveAt(g, r2.t);
    Object.assign(b, { x: g.x0 + g.dir * (g.R + 0.4), z: g.z, y: g.y - 1, vx: 0, vy: 0, vz: 0, ground: true, mode: 0, timer: 0, shield: 0, hitCool: 0 });
    out.length = 0;
    r2.step({ mx: 0, mz: 0, jump: false, dive: false }, out);
    hit = out.some((e) => e.type === "hit" && e.by === "glove");
    if (hit) assert.ok(b.vx > 3, `o pistão não empurrou para fora: vx ${b.vx.toFixed(2)}`);
    void q;
  }
  assert.ok(hit, "o pistão não socou");
});

// ── Estaleiro do Quebra-Gelo (2026-11-20) ────────────────────────────────────
test("gincana — Estaleiro: a hélice em pé derruba quem a pá pega e deixa passar pelo vão", () => {
  const C = G.COURSES.estaleiro;
  assert.equal(C.mode, "race");
  assert.equal(C.rotors.length, 9);
  const q = C.rotors[0];
  // a ponta da pá raspa o chão do cais
  assert.ok(q.y - q.L < G.DECK + 0.5 && q.y - q.L > G.DECK - 0.6, "a pá não chega no chão");
  const { race, r } = solo("estaleiro");
  // no plano da hélice, embaixo do cubo: em algum momento a pá derruba
  const out = [];
  let hit = false;
  let free = false;
  for (let s = 0; s < 600 && !(hit && free); s++) {
    Object.assign(r, { x: q.x + 1.2, z: q.z, y: G.DECK, vx: 0, vy: 0, vz: 0, ground: true, mode: 0, timer: 0, shield: 0, hitCool: 0 });
    out.length = 0;
    race.step({ mx: 0, mz: 0, jump: false, dive: false }, out);
    if (out.some((e) => e.type === "hit")) {
      hit = true;
      assert.ok(r.vz < -3, `a pá não jogou para trás: vz ${r.vz.toFixed(2)}`);
    } else free = true;
  }
  assert.ok(hit, "a pá nunca pegou");
  assert.ok(free, "não há vão: a pá pega sempre");
});

// ── Gangorras do Desfiladeiro (2026-11-20) ───────────────────────────────────
test("gincana — Gangorras: a tábua tomba pelo PESO de quem está em cima e volta ao repouso sozinha", () => {
  const C = G.COURSES.gangorras;
  assert.equal(C.mode, "race");
  assert.ok(C.saws.length >= 15);
  const S = C.saws[1];
  const { race, r } = solo("gangorras");
  while (race.t < 0) race.step();
  // em repouso: a ponta de perto no chão do patamar
  assert.ok(Math.abs(G.sawTop(S, race.world.saw[2], S.x, S.z - S.hz) - G.DECK) < 0.05, "a ponta de perto não descansa no chão");
  // em pé na metade da frente: tomba até o batente, e a ponta da frente desce ao chão
  for (let k = 0; k < 90; k++) {
    Object.assign(r, { x: S.x, z: S.z + 3, vx: 0, vy: 0, vz: 0, ground: true, mode: 0 });
    r.y = G.sawTop(S, race.world.saw[2], r.x, r.z);
    race.step();
  }
  assert.ok(race.world.saw[2] > S.max - 0.01, `não tombou: ${race.world.saw[2].toFixed(3)}`);
  assert.ok(Math.abs(G.sawTop(S, race.world.saw[2], S.x, S.z + S.hz) - G.DECK) < 0.06, "a ponta da frente não chega no chão");
  // ninguém em cima: a mola devolve ao repouso
  Object.assign(r, { x: 0, z: 27.7, y: G.DECK, vx: 0, vy: 0, vz: 0, ground: true, mode: 0 });
  for (let k = 0; k < 60 * 6; k++) race.step();
  assert.ok(race.world.saw[2] < S.a0 + 0.05, `não voltou: ${race.world.saw[2].toFixed(3)}`);
});

test("gincana — Gangorras: no prato de lado tombado, quem está em cima escorrega para o lado baixo", () => {
  const C = G.COURSES.gangorras;
  const i = C.saws.findIndex((S) => S.ax === 1);
  const S = C.saws[i];
  const { race, r } = solo("gangorras");
  while (race.t < 0) race.step();
  race.world.saw[i * 2] = S.max;
  Object.assign(r, { x: S.x + 0.4, z: S.z, vx: 0, vy: 0, vz: 0, ground: true, mode: 0 });
  r.y = G.sawTop(S, S.max, r.x, r.z);
  const x0 = r.x;
  for (let k = 0; k < 20; k++) race.step({ mx: 0, mz: 0, jump: false, dive: false });
  assert.ok(r.x > x0 + 0.3, `não escorregou: ${(r.x - x0).toFixed(2)}`);
});

// ── Descida dos Aros (2026-11-20) ────────────────────────────────────────────
test("gincana — Aros: passar por dentro do aro dá turbo; pela borda ou por fora, não; o aro que anda vai e volta", () => {
  const C = G.COURSES.aros;
  assert.equal(C.mode, "race");
  assert.ok(C.hoops.length >= 10, "aros de menos");
  // a regra do aro: cruzar o plano dentro do raio útil
  const h = C.hoops[0];
  assert.ok(G.hoopPass(h, 0, h.z - 0.1, h.x, h.y - 0.85, h.z + 0.05), "pelo meio não contou");
  assert.ok(!G.hoopPass(h, 0, h.z - 0.1, h.x + h.R, h.y - 0.85, h.z + 0.05), "pela borda contou");
  assert.ok(!G.hoopPass(h, 0, h.z + 0.05, h.x, h.y - 0.85, h.z + 0.1), "já tinha passado e contou de novo");
  const mov = C.hoops.find((q) => q.mx > 0);
  assert.ok(mov, "falta o aro que anda");
  const xs = [0, 0.7, 1.4, 2.1].map((t) => G.hoopX(mov, t));
  assert.ok(Math.max(...xs) - Math.min(...xs) > 2, "o aro que anda não anda");
  // na corrida: atravessar o 1º aro em pleno pulo dá turbo e o evento
  const { race, r } = solo("aros");
  while (race.t < 0.5) race.step({ mx: 0, mz: 0, jump: false, dive: false }, []);
  Object.assign(r, { x: h.x, z: h.z - 0.4, y: h.y - 0.85, vx: 0, vy: 2, vz: 8, ground: false, boost: 0 });
  const ev = [];
  for (let k = 0; k < 12; k++) race.step({ mx: 0, mz: 1, jump: false, dive: false }, ev);
  assert.ok(ev.some((e) => e.type === "hoop" && e.i === 0), "o aro não contou");
  assert.ok(r.boost > 0, "sem turbo");
  // por fora do aro: nada
  const { race: race2, r: r2 } = solo("aros");
  while (race2.t < 0.5) race2.step({ mx: 0, mz: 0, jump: false, dive: false }, []);
  Object.assign(r2, { x: h.x + h.R + 1.2, z: h.z - 0.4, y: h.y - 0.85, vx: 0, vy: 2, vz: 8, ground: false, boost: 0 });
  const ev2 = [];
  for (let k = 0; k < 12; k++) race2.step({ mx: 0, mz: 1, jump: false, dive: false }, ev2);
  assert.ok(!ev2.some((e) => e.type === "hoop"), "contou por fora");
});
