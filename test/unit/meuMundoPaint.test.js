// test/unit/meuMundoPaint.test.js — MEU MUNDO 3D: Paint (mm3d-35)
//
// A regra do jogo mora no front (features/meu-mundo/paint/sim/*.ts) e o back
// roda a cópia GERADA (src/utils/meuMundoPaint.js). Aqui: a cópia está em dia;
// o mapa é coerente (gatinhos e cápsulas em cima de ilha, ninguém nasce no ar);
// o corpo anda, pula e cai como combinado; a ponte cresce no vão e o degrau
// empilha; a partida conta gatinhos, abre o portal, leva ao chefão, tira
// sangue, nocauteia, apaga tinta do outro time e termina; o chefão (mm3d-38)
// ruge, persegue, dá patada e tapa no chão. E o principal: um
// robô SOBE a torre inteira de cada time só com o que o jogo dá (munição das
// cápsulas no caminho), da base até o portal.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const P = require("../../src/utils/meuMundoPaint");

process.removeAllListeners("warning");

const { TUNING: T, PAINT } = P;

test("paint — a cópia do back está em dia com o front", (t) => {
  const gen = require("../../scripts/build-paint-sim");
  if (!fs.existsSync(gen.SIM)) return t.skip("front fora do lugar");
  const cur = fs.readFileSync(gen.OUT, "utf8").replace(/\r\n/g, "\n");
  assert.equal(cur, gen.build(), "rode node scripts/build-paint-sim.js");
});

test("paint — mapa: 48 gatinhos, cápsulas e nascimentos em cima de ilha", () => {
  const map = P.buildPaintMap();
  assert.equal(map.cats.length, 48);
  assert.equal(new Set(map.cats.map((c) => c.id)).size, 48);
  const onTop = (p) => Math.abs(P.supportAt(map.solids, p.x, p.z, p.y + 0.01) - p.y) < 1e-6;
  for (const c of map.cats) assert.ok(onTop(c), `gatinho ${c.id} no ar`);
  for (const c of map.capsules) assert.ok(onTop(c), `cápsula ${c.id} no ar`);
  for (const b of map.bases) for (const s of b.spawns) assert.ok(onTop(s), "nascimento no ar");
  for (const s of map.boss.spawns) assert.ok(onTop(s), "nascimento do chefão no ar");
  for (const p of map.portals) assert.ok(onTop(p), "portal no ar");
  // Mais de 20 por lado não dá: o portal exige ir ao meio (ou ao outro lado).
  const teamOf = (c) => map.islands.find((i) => Math.abs(i.y - c.y) < 1e-6 && Math.hypot(i.x - c.x, i.z - c.z) <= i.r).team;
  const side = (team) => map.cats.filter((c) => teamOf(c) === team).length;
  assert.equal(side(-1), 12);
  assert.equal(side(0), 18);
  assert.equal(side(1), 18);
  assert.ok(side(0) < T.catsToPortal);
  // Ilhas não se atravessam (sobreposição de lado só com 4 m de altura entre elas).
  for (const a of map.islands) {
    for (const b of map.islands) {
      if (a.id >= b.id) continue
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d < a.r + b.r) assert.ok(Math.abs(a.y - b.y) >= 4, `ilhas ${a.id}/${b.id} se atravessam`);
    }
  }
});

function stepN(b, it, solids, n) {
  let mv = 0;
  for (let i = 0; i < n; i++) mv = P.stepBody(b, i === 0 ? it : { ...it, jump: false }, solids);
  return mv;
}

test("paint — corpo: anda, pula ~1,3 m, não sobe 1 m andando, cai do vão", () => {
  const map = P.buildPaintMap();
  const base = map.islands[map.bases[0].island];
  const b = P.newBody(base.x, base.y, base.z, 0);
  stepN(b, { mx: 0, mz: 0, run: false, jump: false }, map.solids, 30);
  assert.ok(b.ground && Math.abs(b.y) < 1e-9);
  // pulo
  let top = 0;
  P.stepBody(b, { mx: 0, mz: 0, run: false, jump: true }, map.solids);
  for (let i = 0; i < 90; i++) {
    P.stepBody(b, { mx: 0, mz: 0, run: false, jump: false }, map.solids);
    top = Math.max(top, b.y);
  }
  assert.ok(top > 1.2 && top < 1.45, `altura do pulo ${top}`);
  assert.ok(b.ground);
  // degrau de 1 m: andando não sobe; 0,4 m sobe sozinho
  const step = [{ k: 0, x: b.x, z: b.z + 2, y0: 0, y1: 1, r: 0.85 }];
  const low = [{ k: 0, x: b.x, z: b.z + 2, y0: 0, y1: 0.4, r: 0.85 }];
  const b1 = P.newBody(b.x, 0, b.z, 0);
  stepN(b1, { mx: 0, mz: 1, run: false, jump: false }, [...map.solids, ...step], 90);
  assert.ok(b1.y < 0.01 && b1.z < b.z + 2 - 0.85, "subiu 1 m andando");
  const b2 = P.newBody(b.x, 0, b.z, 0);
  stepN(b2, { mx: 0, mz: 1, run: false, jump: false }, [...map.solids, ...low], 60);
  assert.ok(Math.abs(b2.y - 0.4) < 0.01 || b2.z > b.z + 2.85, "não subiu 0,4 m");
  // sai pela borda e cai
  const b3 = P.newBody(base.x, 0, base.z, 0);
  stepN(b3, { mx: 0, mz: -1, run: true, jump: false }, map.solids, 300);
  assert.ok(b3.y < -5, "não caiu da borda");
  assert.ok(P.fellOut(-30, false) && !P.fellOut(-10, false));
});

test("paint — pulo duplo: o 2º pulo no ar sobe mais, o 3º não existe; no chão volta a ter dois", () => {
  const map = P.buildPaintMap();
  const base = map.islands[map.bases[0].island];
  const b = P.newBody(base.x, 0, base.z, 0);
  const idle = { mx: 0, mz: 0, run: false, jump: false };
  P.stepBody(b, { ...idle, jump: true }, map.solids);
  assert.equal(b.jumps, 1);
  let top = 0;
  for (let i = 0; i < 25; i++) {
    P.stepBody(b, idle, map.solids);
    top = Math.max(top, b.y);
  }
  P.stepBody(b, { ...idle, jump: true }, map.solids);
  assert.equal(b.jumps, 2);
  assert.ok(b.vy > 6, "o 2º pulo não subiu");
  for (let i = 0; i < 12; i++) P.stepBody(b, idle, map.solids);
  const vy = b.vy;
  P.stepBody(b, { ...idle, jump: true }, map.solids);
  assert.ok(b.vy < vy, "3º pulo no ar não pode existir");
  for (let i = 0; i < 120; i++) {
    P.stepBody(b, idle, map.solids);
    top = Math.max(top, b.y);
  }
  assert.ok(top > 2.2 && top < 3.2, `altura do pulo duplo ${top}`);
  assert.ok(b.ground && b.jumps === 0, "no chão volta a ter os dois pulos");
  // caiu da borda sem pular: ainda tem um pulo no ar
  const c = P.newBody(base.x, 0, base.z, 0);
  for (let i = 0; i < 300 && c.ground; i++) P.stepBody(c, { mx: 0, mz: -1, run: true, jump: false }, map.solids);
  for (let i = 0; i < 10; i++) P.stepBody(c, idle, map.solids);
  P.stepBody(c, { ...idle, jump: true }, map.solids);
  assert.ok(c.vy > 6 && c.jumps === 2, "sem o pulo no ar depois de cair da borda");
});

/** Mundo de tiro só com o mapa + tinta já feita. */
function world(solids) {
  return { solids, bodies: [], boss: null };
}

test("paint — ponte cresce no vão a cada tiro e dá para andar nela", () => {
  const map = P.buildPaintMap();
  const base = map.islands[map.bases[0].island];
  // Na borda leste... não: na borda NORTE da base (z+), mirando o vazio.
  const b = P.newBody(base.x, 0, base.z + base.r - 0.6, 0);
  const solids = map.solids.slice();
  let lastZ = -Infinity;
  for (let i = 0; i < 6; i++) {
    const s = { slot: 0, team: 0, x: b.x, y: b.y, z: b.z, ground: true, gy: b.gy, facing: 0 };
    const o = P.muzzleOf(s, 0);
    const r = P.resolveShot(world(solids), s, PAINT.BRIDGE, o, { x: 0, y: 0.05, z: 1 });
    assert.equal(r.kind, "blob");
    assert.ok(r.blob.z > lastZ, "a ponte não cresceu");
    assert.ok(Math.abs(r.blob.y1 - 0) < 1e-6, "ponte fora da altura do chão");
    lastZ = r.blob.z;
    solids.push(P.blobSolid(r.blob, i + 1, 0));
  }
  assert.ok(lastZ > base.z + base.r + 5, `ponte curta ${lastZ - base.z - base.r}`);
  stepN(b, { mx: 0, mz: 1, run: false, jump: false }, solids, 90);
  assert.ok(b.ground && Math.abs(b.y) < 0.01 && b.z > base.z + base.r + 2, "não andou na ponte");
});

test("paint — pulou e atirou turquesa: a ponte nasce na altura do pé, no ar, e ele pousa nela", () => {
  const map = P.buildPaintMap();
  const base = map.islands[map.bases[0].island];
  const b = P.newBody(base.x, 0, base.z + base.r - 0.7, 0);
  const solids = map.solids.slice();
  P.stepBody(b, { mx: 0, mz: 0, run: false, jump: true }, solids);
  for (let i = 0; i < 30 && b.vy > 0.5; i++) P.stepBody(b, { mx: 0, mz: 0, run: false, jump: false }, solids);
  assert.ok(!b.ground && b.y > 1, "não está no alto do pulo");
  const s = { slot: 0, team: 0, x: b.x, y: b.y, z: b.z, ground: false, gy: b.gy, facing: 0 };
  const r = P.resolveShot(world(solids), s, PAINT.BRIDGE, P.muzzleOf(s, 0), { x: 0, y: 0, z: 1 });
  assert.equal(r.kind, "blob");
  assert.ok(Math.abs(r.blob.y1 - s.y) < 1e-3, `ponte na altura errada: ${r.blob.y1} × pé ${s.y}`);
  solids.push(P.blobSolid(r.blob, 9, 0));
  for (let i = 0; i < 120 && !b.ground; i++) P.stepBody(b, { mx: 0, mz: 1, run: false, jump: false }, solids);
  assert.ok(b.ground && Math.abs(b.y - r.blob.y1) < 0.01, `não pousou na ponte do alto (y ${b.y})`);
});

test("paint — cama elástica: pisou, é lançado ~4 m; no ar ainda pula mais uma vez", () => {
  const map = P.buildPaintMap();
  const base = map.islands[map.bases[0].island];
  const b = P.newBody(base.x, 0, base.z, 0);
  const solids = map.solids.slice();
  const s = { slot: 0, team: 0, x: b.x, y: b.y, z: b.z, ground: true, gy: 0, facing: 0 };
  const r = P.resolveShot(world(solids), s, PAINT.STEP, P.muzzleOf(s, 0), { x: 0, y: -1, z: 0 });
  assert.equal(r.kind, "blob");
  assert.ok(r.blob.y1 - r.blob.y0 <= T.stepUp, "a cama elástica tem que dar para entrar andando");
  solids.push(P.blobSolid(r.blob, 7, 0));
  // anda até ela: quica
  let bounced = null;
  let top = 0;
  for (let i = 0; i < 120 && bounced === null; i++) {
    P.stepBody(b, { mx: 0, mz: 1, run: false, jump: false }, solids);
    if (b.bounce !== null) bounced = b.bounce;
  }
  assert.equal(bounced, 7, "não quicou na cama elástica");
  assert.ok(b.vy > 12 && !b.ground && b.jumps === 1);
  for (let i = 0; i < 200; i++) {
    P.stepBody(b, { mx: 0, mz: 0, run: false, jump: false }, solids);
    top = Math.max(top, b.y);
    if (b.vy < 0) break;
  }
  assert.ok(top > 4.2 && top < 5, `altura do quique ${top}`);
  P.stepBody(b, { mx: 0, mz: 0, run: false, jump: true }, solids);
  assert.ok(b.vy > 6 && b.jumps === 2, "sem o pulo no ar depois do quique");
});

// ── Robô que sobe a torre ────────────────────────────────────────────────────

/** Jogador que só usa o corpo e a partida (como o aparelho faria). */
function climber(match, slot) {
  const p = match.players.get(slot);
  const b = P.newBody(p.pose.x, p.pose.y, p.pose.z, p.pose.facing);
  let q = 0;
  const sync = () => {
    match.pose(slot, { x: b.x, y: b.y, z: b.z, facing: b.facing, ground: b.ground, gy: b.gy, e: p.epoch });
  };
  const run = (it, n = 1) => {
    for (let i = 0; i < n; i++) {
      P.stepBody(b, i === 0 ? it : { ...it, jump: false }, match.solids());
      match.tick(T.step);
      sync();
      for (const e of match.drain()) {
        if (e.type === "respawn" && e.slot === slot) Object.assign(b, P.newBody(e.x, e.y, e.z, e.facing));
      }
    }
  };
  const fire = (c, dir) => {
    // espera o ritmo da arma
    while (match.time + 0.03 < p.nextFire[c]) run({ mx: 0, mz: 0, run: false, jump: false });
    const o = P.muzzleOf(b, b.facing);
    const before = match.blobs.size;
    match.fire(slot, c, o, dir, ++q);
    const made = match.blobs.size > before ? [...match.blobs.values()].pop() : null;
    if (made && made.owner === slot) P.liftOnto(b, made.blob.x, made.blob.z, made.blob.r, made.blob.y1);
    return made;
  };
  /** Anda até (x, z) no plano; para na borda (não cai) se `safe`. */
  const walkTo = (x, z, safe, maxN = 600) => {
    for (let i = 0; i < maxN; i++) {
      const dx = x - b.x;
      const dz = z - b.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.25) break;
      if (safe) {
        const nx = b.x + (dx / d) * 0.5;
        const nz = b.z + (dz / d) * 0.5;
        if (P.supportAt(match.solids(), nx, nz, b.y + 0.3) < b.y - 0.5) break;
      }
      const s = Math.min(1, d / 1.2);
      run({ mx: (dx / d) * s, mz: (dz / d) * s, run: false, jump: false });
    }
    run({ mx: 0, mz: 0, run: false, jump: false }, 20);
  };
  const face = (x, z) => {
    b.facing = Math.atan2(x - b.x, z - b.z);
  };
  /** Vai da ilha em que está até a ilha `to` (ponte na altura daqui + cama elástica para subir). */
  const hop = (to) => {
    const dx = to.x - b.x;
    const dz = to.z - b.z;
    const d = Math.hypot(dx, dz);
    const ux = dx / d;
    const uz = dz / d;
    // até a borda, olhando para a próxima
    walkTo(b.x + ux * 30, b.z + uz * 30, true);
    face(to.x, to.z);
    // ponte na altura daqui até encostar na ilha de lá
    let guard = 0;
    for (;;) {
      const reach = Math.hypot(to.x - b.x, to.z - b.z) - to.r;
      const made = [...match.blobs.values()].filter((x) => x.owner === slot && x.blob.c === PAINT.BRIDGE);
      const far = made.length ? Math.min(...made.map((x) => Math.hypot(to.x - x.blob.x, to.z - x.blob.z))) : Infinity;
      if (reach < 0.5 || far < to.r + 0.4) break;
      assert.ok(guard++ < 40, `ponte não chega na ilha ${to.id}`);
      assert.ok(p.ammo[PAINT.BRIDGE] >= 1, `sem munição turquesa indo para a ilha ${to.id}`);
      fire(PAINT.BRIDGE, { x: ux, y: 0, z: uz });
      walkTo(b.x + ux * 30, b.z + uz * 30, true, 40);
    }
    if (to.y > b.y + 0.3) {
      // perto da parede de lá, cama elástica logo atrás de si; volta nela, é
      // lançado e vai para cima da ilha (pula no ar se faltar altura)
      // fica a ~1,4 m da borda de lá (nem embaixo da ilha, se a ponte passou por baixo)
      for (let i = 0; i < 400; i++) {
        const gap = Math.hypot(to.x - b.x, to.z - b.z) - (to.r + 1.4);
        if (Math.abs(gap) < 0.12) break;
        const before = { x: b.x, z: b.z };
        const sgn = gap > 0 ? 1 : -1;
        run({ mx: ux * sgn * 0.5, mz: uz * sgn * 0.5, run: false, jump: false });
        if (Math.hypot(b.x - before.x, b.z - before.z) < 1e-4) break;
      }
      run({ mx: 0, mz: 0, run: false, jump: false }, 20);
      assert.ok(p.ammo[PAINT.STEP] >= T.cost[PAINT.STEP], `sem munição amarela indo para a ilha ${to.id}`);
      b.facing = Math.atan2(-ux, -uz);
      run({ mx: 0, mz: 0, run: false, jump: false }); // a partida fica com a pose virada
      const pad = fire(PAINT.STEP, { x: 0, y: -1, z: 0 });
      assert.ok(pad && pad.blob.c === PAINT.STEP, `a cama elástica não nasceu (ilha ${to.id})`);
      let bounced = false;
      for (let i = 0; i < 300; i++) {
        // sobe reto e só avança acima do topo de lá (o topo é uma ilha suspensa: avançar subindo bate a cabeça embaixo dela)
        const toward = bounced ? (b.y > to.y + 0.1 ? 1 : 0) : -1;
        const jump = bounced && !b.ground && b.vy < 1 && b.y < to.y + 0.4 && b.jumps < T.maxJumps;
        run({ mx: ux * toward, mz: uz * toward, run: false, jump });
        if (b.bounce !== null) bounced = true;
        if (bounced && b.ground) break;
      }
      assert.ok(bounced, `não quicou na cama elástica (ilha ${to.id})`);
    }
    walkTo(to.x, to.z, false);
    assert.ok(Math.abs(b.y - to.y) < 0.05 && Math.hypot(b.x - to.x, b.z - to.z) < to.r, `não chegou na ilha ${to.id} (y ${b.y} × ${to.y})`);
  };
  /** Passa pelas cápsulas e gatinhos da ilha em que está. */
  const sweep = (isl) => {
    for (const c of match.map.capsules) if (Math.abs(c.y - isl.y) < 0.01 && Math.hypot(c.x - isl.x, c.z - isl.z) <= isl.r) walkTo(c.x, c.z, true);
    for (const c of match.map.cats) if (Math.abs(c.y - isl.y) < 0.01 && Math.hypot(c.x - isl.x, c.z - isl.z) <= isl.r) walkTo(c.x, c.z, true);
    walkTo(isl.x, isl.z, false);
  };
  return { b, p, hop, sweep, run, fire };
}

for (const team of [0, 1]) {
  test(`paint — robô do time ${team} sobe a torre inteira da base ao topo`, () => {
    const match = new P.PaintMatch("1v1", [
      { slot: 0, team: 0, sit: 0 },
      { slot: 1, team: 1, sit: 0 },
    ]);
    match.tick(T.countdown + 0.01);
    assert.equal(match.phase, "play");
    const bot = climber(match, team);
    const islands = match.map.islands.filter((i) => i.team === team && (i.kind === "path" || i.kind === "summit"));
    const base = match.map.islands[match.map.bases[team].island];
    bot.sweep(base);
    for (const isl of islands) {
      bot.hop(isl);
      bot.sweep(isl);
    }
    assert.ok(bot.p.cats >= 14, `gatinhos da base + espiral + topo: ${bot.p.cats}`);
    assert.ok(bot.b.y >= 29.9);
  });
}

// ── Partida ──────────────────────────────────────────────────────────────────

function duel() {
  const m = new P.PaintMatch("1v1", [
    { slot: 0, team: 0, sit: 0 },
    { slot: 1, team: 1, sit: 0 },
  ]);
  m.tick(T.countdown + 0.01);
  m.drain();
  return m;
}
const place = (m, slot, x, y, z, facing = 0) => {
  const p = m.players.get(slot);
  p.pose = { x, y, z, facing, ground: true, gy: y, e: p.epoch };
};

test("paint — tiro vermelho tira sangue do outro time, soco empurra, sangue zerado = nocaute e volta à base", () => {
  const m = duel();
  const base = m.map.islands[m.map.bases[0].island];
  place(m, 0, base.x, 0, base.z, 0);
  place(m, 1, base.x, 0, base.z + 6, Math.PI);
  const shoot = (q) => {
    const a = m.players.get(0).pose;
    const o = P.muzzleOf(a, a.facing);
    m.fire(0, PAINT.HARM, o, { x: base.x - o.x, y: 1.0 - o.y + 0.2, z: base.z + 6 - o.z }, q);
    m.tick(1 / T.fireRate[PAINT.HARM] + 0.01);
  };
  shoot(1);
  let ev = m.drain();
  const hit = ev.find((e) => e.type === "hit");
  assert.ok(hit && hit.slot === 1 && hit.hp === T.hpMax - T.harmDmg && hit.how === "harm" && hit.kz > 0);
  // soco: perto e de frente
  place(m, 1, base.x, 0, base.z + 1.2, Math.PI);
  m.punch(0);
  ev = m.drain();
  const ph = ev.find((e) => e.type === "hit");
  assert.ok(ph && ph.how === "punch" && ph.hp === T.hpMax - T.harmDmg - T.punchDmg && ph.kz > 5);
  // soco de novo antes do tempo: nada
  m.punch(0);
  assert.equal(m.drain().filter((e) => e.type === "hit").length, 0);
  place(m, 1, base.x, 0, base.z + 6, Math.PI);
  // 65 de sangue: 3 tiros deixam 5, o 4º derruba
  for (let q = 2; q <= 4; q++) shoot(q);
  assert.ok(!m.drain().find((e) => e.type === "ko"));
  assert.equal(m.players.get(1).hp, 5);
  shoot(5);
  ev = m.drain();
  assert.ok(ev.find((e) => e.type === "ko" && e.slot === 1));
  assert.ok(m.players.get(1).ko > 0);
  m.tick(T.koTime + 0.1);
  ev = m.drain();
  const rs = ev.find((e) => e.type === "respawn" && e.slot === 1);
  assert.ok(rs && rs.e === 1 && !rs.inBoss);
  assert.equal(m.players.get(1).hp, T.hpMax);
  assert.ok(rs.x > 0, "time 1 volta à base leste");
  // escudo: logo depois de voltar não toma dano
  place(m, 1, base.x, 0, base.z + 6, Math.PI);
  m.players.get(1).epoch = 1;
  shoot(9);
  assert.equal(m.drain().filter((e) => e.type === "hit").length, 0);
});

test("paint — nocaute por tiro: quem derrubou fica com os gatinhos de quem caiu (placar e portal)", () => {
  const m = duel();
  // o time 1 pega 12 gatinhos; o time 0 já tem 9
  const p0 = m.players.get(0);
  const p1 = m.players.get(1);
  p1.cats = 12;
  m.teamCats[1] = 12;
  p0.cats = 9;
  m.teamCats[0] = 9;
  const base = m.map.islands[m.map.bases[0].island];
  place(m, 0, base.x, 0, base.z, 0);
  place(m, 1, base.x, 0, base.z + 6, Math.PI);
  for (let q = 1; q <= 5; q++) {
    const o = P.muzzleOf(m.players.get(0).pose, 0);
    m.fire(0, PAINT.HARM, o, { x: base.x - o.x, y: 1.2 - o.y, z: base.z + 6 - o.z }, q);
    m.tick(1 / T.fireRate[PAINT.HARM] + 0.01);
  }
  const ev = m.drain();
  const st = ev.find((e) => e.type === "steal");
  assert.ok(ev.find((e) => e.type === "ko" && e.slot === 1), "não nocauteou");
  assert.ok(st && st.from === 1 && st.to === 0 && st.n === 12, JSON.stringify(st));
  assert.equal(p1.cats, 0);
  assert.equal(p0.cats, 21);
  assert.deepEqual([...m.teamCats], [21, 0]);
  assert.ok(m.portalOpen[0] && ev.find((e) => e.type === "portal" && e.team === 0), "o portal de quem roubou não abriu");
  // cair nas nuvens não dá gatinho para ninguém: os do jogador voltam ao mapa
  const stolen = [...p0.catIds];
  assert.equal(p1.catIds.length, 0);
  place(m, 0, base.x, -40, base.z);
  m.tick(0.05);
  const fall = m.drain();
  assert.ok(!fall.find((e) => e.type === "steal"));
  assert.equal(p0.cats, 0);
  assert.equal(m.teamCats[0], 0);
  assert.ok(m.portalOpen[0], "portal que já abriu fica aberto");
  const drop = fall.find((e) => e.type === "drop");
  assert.ok(drop && drop.slot === 0 && drop.n === 21);
  assert.deepEqual(fall.filter((e) => e.type === "catBack").map((e) => e.id).sort(), stolen.sort());
});

test("paint — caiu com gatinhos: eles voltam ao mapa e podem ser pegos de novo", () => {
  const m = duel();
  const p = m.players.get(0);
  const few = m.map.cats.filter((c) => c.x < 1).slice(0, 3);
  for (const c of few) {
    place(m, 0, c.x, c.y, c.z);
    m.tick(0.02);
  }
  assert.equal(p.cats, 3);
  assert.deepEqual(p.catIds, few.map((c) => c.id));
  m.drain();
  place(m, 0, few[0].x, -40, few[0].z);
  m.tick(0.02);
  const ev = m.drain();
  assert.equal(ev.filter((e) => e.type === "catBack").length, 3);
  for (const c of few) assert.ok(!m.catsTaken.has(c.id), `gatinho ${c.id} não voltou`);
  assert.equal(m.teamCats[0], 0);
  // o outro jogador pega um deles
  const c = few[1];
  place(m, 1, c.x, c.y, c.z);
  m.tick(0.02);
  assert.equal(m.players.get(1).cats, 1);
  assert.equal(m.catsTaken.get(c.id), 1);
});

test("paint — na ilha do chefão: jogador não machuca jogador e ninguém perde gatinho", () => {
  const m = duel();
  const a = m.players.get(0);
  const v = m.players.get(1);
  a.inBoss = v.inBoss = true;
  v.cats = 7;
  v.catIds = [1, 2, 3, 4, 5, 6, 7];
  m.teamCats[1] = 7;
  const h = m.map.boss;
  place(m, 0, h.x - 12, h.y, h.z - 8, 0);
  place(m, 1, h.x - 12, h.y, h.z - 2, Math.PI);
  m.punch(0);
  const o = P.muzzleOf(a.pose, 0);
  m.fire(0, PAINT.HARM, o, { x: 0, y: 0, z: 1 }, 1);
  assert.equal(m.drain().filter((e) => e.type === "hit").length, 0);
  assert.equal(v.hp, T.hpMax);
  // caiu da ilha do chefão: volta lá em cima, com os gatinhos
  place(m, 1, h.x, h.y - 40, h.z);
  m.tick(0.02);
  const ev = m.drain();
  assert.ok(ev.find((e) => e.type === "respawn" && e.slot === 1 && e.inBoss));
  assert.ok(!ev.find((e) => e.type === "drop"));
  assert.equal(v.cats, 7);
});

test("paint — chefão: ruge quando o primeiro chega, persegue, dá patada e tapa no chão; não sai da ilha", () => {
  const m = duel();
  const p = m.players.get(0);
  const h = m.map.boss;
  // ninguém lá em cima: fica parado no meio
  m.tick(1);
  assert.equal(m.boss.act, "idle");
  assert.ok(Math.hypot(m.boss.x - h.x, m.boss.z - h.z) < 1e-6);
  p.inBoss = true;
  place(m, 0, h.x, h.y, h.z - 11);
  m.tick(0.05);
  let ev = m.drain();
  assert.ok(ev.find((e) => e.type === "bossAct" && e.act === "roar" && e.slot === 0));
  assert.equal(m.boss.act, "roar");
  // rugido não tira sangue; depois ele anda até a vítima
  for (let i = 0; i < 50; i++) m.tick(0.05);
  assert.equal(p.hp, T.hpMax);
  assert.equal(m.boss.act, "walk");
  // anda até a patada e acerta (empurra para longe)
  const acts = [];
  const hits = [];
  for (let i = 0; i < 400 && hits.length < 3; i++) {
    m.tick(0.05);
    for (const e of m.drain()) {
      if (e.type === "bossAct") acts.push(e.act);
      if (e.type === "hit" && e.by === -1) hits.push(e);
    }
    // a vítima fica parada (sem escudo: volta a ter sangue para apanhar de novo)
    if (p.ko) {
      p.ko = 0;
      p.hp = T.hpMax;
    }
    p.shield = 0;
  }
  assert.ok(hits.length >= 3, `golpes: ${hits.length}`);
  assert.deepEqual(acts.slice(0, 3), ["swipe", "swipe", "slam"]);
  assert.equal(hits[0].how, "boss");
  assert.equal(hits[0].hp, T.hpMax - T.bossSwipe.dmg);
  assert.ok(hits[0].kz < 0, "patada empurra para longe do chefão");
  assert.ok(hits[2].ky === T.bossSlam.lift);
  // no ar escapa do tapa no chão
  p.hp = T.hpMax;
  m.boss.count = 2;
  m.boss.next = 0;
  m.boss.act = "idle";
  for (let i = 0; i < 40 && m.boss.act !== "slam"; i++) m.tick(0.05);
  assert.equal(m.boss.act, "slam");
  p.pose.ground = false;
  p.pose.y = h.y + 1.5;
  for (let i = 0; i < 30; i++) m.tick(0.05);
  assert.ok(!m.drain().find((e) => e.type === "hit"), "no ar não leva o tapa no chão");
  // corre para a borda: ele segue mas não sai do raio
  place(m, 0, h.x, h.y, h.z - 17.5);
  for (let i = 0; i < 400; i++) {
    m.tick(0.05);
    p.shield = m.time + 10;
  }
  assert.ok(Math.hypot(m.boss.x - h.x, m.boss.z - h.z) <= T.bossLeash + 1e-6);
});

test("paint — chefão derruba: ko sem ladrão, volta lá em cima; metade da vida = novo rugido", () => {
  const m = duel();
  const p = m.players.get(0);
  const h = m.map.boss;
  p.inBoss = true;
  p.cats = 4;
  p.catIds = [1, 2, 3, 4];
  m.boss.roared = true;
  place(m, 0, h.x, h.y, h.z - 4);
  p.hp = 10;
  let ko = null;
  for (let i = 0; i < 200 && !ko; i++) {
    m.tick(0.05);
    ko = m.drain().find((e) => e.type === "ko");
  }
  assert.ok(ko && ko.slot === 0 && ko.by === -1);
  assert.equal(p.cats, 4);
  m.tick(T.koTime + 0.1);
  const rs = m.drain().find((e) => e.type === "respawn");
  assert.ok(rs && rs.inBoss);
  // metade da vida: ruge de novo (uma vez)
  m.bossHp = T.bossHp / 2;
  m.boss.act = "idle";
  place(m, 0, h.x, h.y, h.z - 10);
  p.shield = m.time + 100;
  let roars = 0;
  for (let i = 0; i < 200; i++) {
    m.tick(0.05);
    roars += m.drain().filter((e) => e.type === "bossAct" && e.act === "roar").length;
  }
  assert.equal(roars, 1);
});

test("paint — mesmo time não se machuca; vermelho apaga tinta do outro time", () => {
  const m = new P.PaintMatch("2v2", [
    { slot: 0, team: 0, sit: 0 },
    { slot: 1, team: 0, sit: 1 },
    { slot: 2, team: 1, sit: 0 },
  ]);
  m.tick(T.countdown + 0.01);
  m.drain();
  const base = m.map.islands[m.map.bases[0].island];
  place(m, 0, base.x, 0, base.z);
  place(m, 1, base.x, 0, base.z + 5);
  const a = m.players.get(0).pose;
  m.fire(0, PAINT.HARM, P.muzzleOf(a, 0), { x: 0, y: -0.05, z: 1 }, 1);
  assert.equal(m.drain().filter((e) => e.type === "hit").length, 0);
  // tinta do time 1 na borda; o time 0 apaga
  place(m, 2, base.x, 0, base.z + base.r - 0.6, 0);
  const e2 = m.players.get(2).pose;
  m.fire(2, PAINT.BRIDGE, P.muzzleOf(e2, 0), { x: 0, y: 0, z: 1 }, 1);
  const blob = m.drain().find((e) => e.type === "blob");
  assert.ok(blob);
  place(m, 2, base.x + 5, 0, base.z - 5); // sai da frente do tiro
  place(m, 1, base.x - 1.2, 0, base.z + base.r - 2.4, 0); // longe do pilar da borda
  m.tick(0.2);
  const s1 = m.players.get(1).pose;
  const o = P.muzzleOf(s1, 0);
  m.fire(1, PAINT.HARM, o, { x: blob.blob.x - o.x, y: blob.blob.y1 - 0.1 - o.y, z: blob.blob.z - o.z }, 2);
  const ev = m.drain();
  assert.ok(ev.find((e) => e.type === "unblob" && e.id === blob.id), "não apagou a tinta do outro time");
  assert.ok(!m.blobs.has(blob.id));
});

test("paint — munição acaba, ritmo da arma, cápsula recarrega e volta em 10 s", () => {
  const m = duel();
  const base = m.map.islands[m.map.bases[0].island];
  place(m, 0, base.x, 0, base.z);
  const p = m.players.get(0);
  const shoot = (q) => m.fire(0, PAINT.HARM, P.muzzleOf(p.pose, 0), { x: 0, y: 1, z: 0 }, q);
  shoot(1);
  shoot(2); // cedo demais
  assert.equal(p.ammo[PAINT.HARM], T.ammoStart - 1);
  for (let q = 3; q < 200 && p.ammo[PAINT.HARM] > 0; q++) {
    m.tick(1 / T.fireRate[PAINT.HARM] + 0.001);
    shoot(q);
  }
  assert.equal(p.ammo[PAINT.HARM], 0);
  m.drain();
  m.tick(1);
  shoot(500);
  assert.ok(m.drain().find((e) => e.type === "deny" && e.q === 500));
  const cap = m.map.capsules.find((c) => c.c === PAINT.HARM && Math.abs(c.y) < 1e-6 && c.x < 0);
  place(m, 0, cap.x, cap.y, cap.z);
  m.tick(0.02);
  assert.equal(p.ammo[PAINT.HARM], T.capsuleGive);
  assert.ok(m.drain().find((e) => e.type === "capsule" && e.id === cap.id));
  m.tick(T.capsuleRespawn + 0.05);
  assert.ok(m.drain().find((e) => e.type === "capsuleBack" && e.id === cap.id));
});

test("paint — 20 gatinhos abrem o portal do time, portal leva ao chefão, dano no chefão decide", () => {
  const m = duel();
  const p = m.players.get(0);
  const mine = m.map.cats.filter((c) => c.x < 1).slice(0, T.catsToPortal);
  for (const c of mine) {
    place(m, 0, c.x, c.y, c.z);
    m.tick(0.02);
  }
  const ev = m.drain();
  assert.equal(ev.filter((e) => e.type === "cat").length, T.catsToPortal);
  assert.ok(ev.find((e) => e.type === "portal" && e.team === 0));
  assert.equal(m.teamCats[0], 20);
  assert.ok(m.portalOpen[0] && !m.portalOpen[1]);
  // gatinho já pego não conta de novo
  place(m, 0, mine[0].x, mine[0].y, mine[0].z);
  m.tick(0.02);
  assert.equal(m.teamCats[0], 20);
  // portal do OUTRO time não serve
  const other = m.map.portals[1];
  place(m, 0, other.x, other.y, other.z);
  m.tick(0.02);
  assert.ok(!p.inBoss);
  const portal = m.map.portals[0];
  place(m, 0, portal.x, portal.y, portal.z);
  m.tick(0.02);
  assert.ok(p.inBoss);
  const rs = m.drain().find((e) => e.type === "respawn");
  assert.ok(rs && rs.inBoss && Math.abs(rs.y - m.map.boss.y) < 1e-6);
  // dano no chefão até acabar (o escudo deixa o teste medir só o dano; ele anda)
  const start = m.bossBody();
  place(m, 0, start.x - 6, start.y, start.z, Math.PI / 2);
  for (let q = 1; m.phase !== "end" && q < 1000; q++) {
    p.shield = m.time + 10;
    if (p.ammo[PAINT.HARM] < 1) p.ammo[PAINT.HARM] = T.ammoMax;
    const boss = m.bossBody();
    p.pose.facing = Math.atan2(boss.x - p.pose.x, boss.z - p.pose.z);
    const o = P.muzzleOf(p.pose, p.pose.facing);
    m.fire(0, PAINT.HARM, o, { x: boss.x - o.x, y: boss.y + 2 - o.y, z: boss.z - o.z }, q);
    m.tick(1 / T.fireRate[PAINT.HARM] + 0.001);
  }
  assert.equal(m.phase, "end");
  assert.equal(m.bossHp, 0);
  assert.equal(m.result.winnerSlot, 0);
  assert.equal(m.result.winnerTeam, 0);
  assert.equal(p.dmg, T.bossHp);
});

test("paint — pose impossível é recusada; caiu nas nuvens volta à base; época velha é ignorada", () => {
  const m = duel();
  const p = m.players.get(0);
  const start = { ...p.pose };
  assert.equal(m.pose(0, { ...start, x: start.x + 40 }), false);
  const fix = m.drain().find((e) => e.type === "fix");
  assert.ok(fix && fix.pose.x === start.x);
  m.tick(0.1);
  assert.equal(m.pose(0, { ...start, x: start.x + 0.5 }), true);
  m.tick(0.1);
  m.pose(0, { ...p.pose, y: -40 });
  // a queda é rápida: desce sem limite
  assert.equal(p.pose.y, -40);
  m.tick(0.02);
  const rs = m.drain().find((e) => e.type === "respawn");
  assert.ok(rs && rs.e === 1);
  // pose da época 0 (de antes do teleporte) não move
  m.pose(0, { ...start, y: -50, e: 0 });
  assert.ok(p.pose.y > -1);
});

test("paint — tempo acaba: sem dano no chefão vence o time com mais gatinhos", () => {
  const m = duel();
  const c = m.map.cats.find((x) => x.x > 1);
  place(m, 1, c.x, c.y, c.z);
  m.tick(0.02);
  m.tick(T.matchTime);
  assert.equal(m.phase, "end");
  assert.equal(m.result.winnerSlot, -1);
  assert.equal(m.result.winnerTeam, 1);
});

// ── mm3d-46: cores novas, o dobro de ilhas, gatinhos por modo e o MURO ──────

test("paint mm3d-46 — o dobro de ilhas, mesmos 48 gatinhos; 2×2 dobra e 3×3 triplica, todos em cima de ilha", () => {
  const old = 2 * (1 + 11 + 4 + 1) + 4; // ilhas da arena antes do mm3d-46
  for (const [mode, k] of [["solo", 1], ["1v1", 1], ["2v2", 2], ["3v3", 3]]) {
    const map = P.buildPaintMap(mode);
    const arena = map.islands.filter((i) => i.kind !== "boss");
    assert.ok(arena.length >= old * 2, `${mode}: ${arena.length} ilhas`);
    assert.equal(map.cats.length, 48 * k, mode);
    assert.equal(new Set(map.cats.map((c) => c.id)).size, 48 * k);
    const onTop = (p) => Math.abs(P.supportAt(map.solids, p.x, p.z, p.y + 0.01) - p.y) < 1e-6;
    for (const c of map.cats) assert.ok(onTop(c), `${mode}: gatinho ${c.id} no ar`);
    for (const c of map.capsules) assert.ok(onTop(c), `${mode}: cápsula ${c.id} no ar`);
    // os 48 de antes não mudam de lugar
    const solo = P.buildPaintMap("solo").cats;
    for (const c of solo) assert.deepEqual(map.cats[c.id], c);
    // espelhado: cada lado tem o mesmo tanto
    const side = (s) => map.cats.filter((c) => Math.sign(c.x) === s && Math.abs(c.x) > 6).length;
    assert.equal(side(-1), side(1), `${mode}: lados desiguais`);
  }
  // ícones da Freelandoo (cápsula do muro): na base de cada time e espelhados
  const map = P.buildPaintMap("1v1");
  const logos = map.capsules.filter((c) => c.c === PAINT.WALL);
  assert.ok(logos.length >= 6);
  for (const b of map.bases) {
    const base = map.islands[b.island];
    assert.ok(logos.some((l) => Math.hypot(l.x - base.x, l.z - base.z) <= base.r && l.y === base.y), "base sem ícone");
  }
});

/** Muro na frente de quem está na base do time 0, de frente para +z. */
function wallMatch() {
  const m = duel();
  const base = m.map.islands[m.map.bases[0].island];
  place(m, 0, base.x, 0, base.z - 3, 0);
  return { m, base };
}

test("paint mm3d-46 — muro: começa sem munição, o ícone dá 10, nasce em pé atravessado na mira", () => {
  const { m, base } = wallMatch();
  const p = m.players.get(0);
  assert.equal(p.ammo[PAINT.WALL], 0);
  const o = P.muzzleOf(p.pose, 0);
  m.fire(0, PAINT.WALL, o, { x: 0, y: -0.3, z: 1 }, 1);
  assert.ok(m.drain().find((e) => e.type === "deny"), "atirou muro sem munição");
  // pega o ícone da base
  const logo = m.map.capsules.find((c) => c.c === PAINT.WALL && Math.hypot(c.x - base.x, c.z - base.z) <= base.r);
  place(m, 0, logo.x, logo.y, logo.z, 0);
  m.tick(0.02);
  assert.equal(p.ammo[PAINT.WALL], T.wallGive);
  const ev = m.drain();
  assert.ok(ev.find((e) => e.type === "capsule" && e.c === PAINT.WALL));
  assert.ok(Math.abs(m.capsuleBack.get(logo.id) - m.time - T.logoRespawn) < 0.05, "o ícone volta em 18 s");
  // atira no chão à frente: muro em pé, de frente para quem atirou
  place(m, 0, base.x, 0, base.z - 3, 0);
  const o2 = P.muzzleOf(p.pose, 0);
  m.fire(0, PAINT.WALL, o2, { x: 0, y: -0.25, z: 1 }, 2);
  const blob = m.drain().find((e) => e.type === "blob");
  assert.ok(blob && blob.blob.c === PAINT.WALL, "o muro não nasceu");
  assert.equal(p.ammo[PAINT.WALL], T.wallGive - 1);
  assert.ok(Math.abs(blob.blob.a) < 1e-3, "muro virado errado");
  assert.ok(Math.abs(blob.blob.y0) < 1e-6 && Math.abs(blob.blob.y1 - T.wallH) < 1e-6, "muro fora do chão");
  assert.ok(blob.blob.z > base.z - 3 + 1, "muro atrás de quem atirou");
  const solid = m.blobs.get(blob.id).solid;
  assert.equal(solid.k, 2);
});

test("paint mm3d-46 — muro barra quem anda e o tiro preto; o preto do outro time derruba no 3º", () => {
  const { m, base } = wallMatch();
  const p0 = m.players.get(0);
  p0.ammo[PAINT.WALL] = 5;
  const o = P.muzzleOf(p0.pose, 0);
  m.fire(0, PAINT.WALL, o, { x: 0, y: -0.25, z: 1 }, 1);
  const w = m.drain().find((e) => e.type === "blob").blob;
  // o corpo não atravessa (nem de lado: muro girado também)
  const b = P.newBody(base.x, 0, base.z - 3, 0);
  for (let i = 0; i < 200; i++) P.stepBody(b, { mx: 0, mz: 1, run: true, jump: false }, m.solids());
  assert.ok(b.z < w.z - T.wallT / 2 - T.bodyR + 0.02, `atravessou o muro (z ${b.z} × ${w.z})`);
  // pulo duplo não passa por cima
  P.stepBody(b, { mx: 0, mz: 1, run: true, jump: true }, m.solids());
  for (let i = 0; i < 30; i++) P.stepBody(b, { mx: 0, mz: 1, run: true, jump: false }, m.solids());
  P.stepBody(b, { mx: 0, mz: 1, run: true, jump: true }, m.solids());
  for (let i = 0; i < 120; i++) P.stepBody(b, { mx: 0, mz: 1, run: true, jump: false }, m.solids());
  assert.ok(b.z < w.z, "o pulo duplo passou por cima do muro");
  // muro girado 90°: barra no eixo x
  const turned = [...m.map.solids, P.blobSolid({ ...w, x: base.x + 2, z: base.z, a: Math.PI / 2 }, 99, 0)];
  const c = P.newBody(base.x, 0, base.z, 0);
  for (let i = 0; i < 200; i++) P.stepBody(c, { mx: 1, mz: 0, run: true, jump: false }, turned);
  assert.ok(c.x < base.x + 2 - T.wallT / 2 - T.bodyR + 0.02, "atravessou o muro girado");
  // o time 1 do outro lado do muro atira preto: o muro segura, não acerta o 0
  place(m, 1, base.x, 0, w.z + 5, Math.PI);
  const shoot = (q) => {
    const a = m.players.get(1).pose;
    const mo = P.muzzleOf(a, a.facing);
    m.fire(1, PAINT.HARM, mo, { x: p0.pose.x - mo.x, y: 1.2 - mo.y, z: p0.pose.z - mo.z }, q);
    m.tick(1 / T.fireRate[PAINT.HARM] + 0.01);
    return m.drain();
  };
  for (let q = 1; q < T.wallHits; q++) {
    const ev = shoot(q);
    assert.ok(!ev.find((e) => e.type === "hit"), "o tiro atravessou o muro");
    assert.ok(!ev.find((e) => e.type === "unblob"), `o muro caiu no ${q}º tiro`);
  }
  assert.ok(shoot(T.wallHits).find((e) => e.type === "unblob"), "o muro não caiu");
  assert.ok(shoot(T.wallHits + 1).find((e) => e.type === "hit" && e.slot === 0), "sem muro o tiro não acertou");
  // o preto do MESMO time não derruba o próprio muro
  p0.ammo[PAINT.WALL] = 5;
  place(m, 0, base.x, 0, base.z - 3, 0);
  m.tick(1);
  m.fire(0, PAINT.WALL, P.muzzleOf(p0.pose, 0), { x: 0, y: -0.25, z: 1 }, 7);
  const own = m.drain().find((e) => e.type === "blob");
  for (let q = 10; q < 16; q++) {
    m.fire(0, PAINT.HARM, P.muzzleOf(p0.pose, 0), { x: 0, y: 0, z: 1 }, q);
    m.tick(0.2);
  }
  assert.ok(m.blobs.has(own.id), "o próprio time derrubou o muro");
});

test("paint mm3d-46 — mirando o topo de um muro, o próximo empilha em cima", () => {
  const { m, base } = wallMatch();
  const p = m.players.get(0);
  p.ammo[PAINT.WALL] = 5;
  m.fire(0, PAINT.WALL, P.muzzleOf(p.pose, 0), { x: 0, y: -0.25, z: 1 }, 1);
  const w = m.drain().find((e) => e.type === "blob").blob;
  m.tick(0.5);
  // de cima de uma ponte alta, mirando o topo do muro
  place(m, 0, base.x, 4.5, base.z - 3, 0);
  const o = P.muzzleOf(p.pose, 0);
  m.fire(0, PAINT.WALL, o, { x: w.x - o.x, y: w.y1 - o.y, z: w.z - o.z }, 2);
  const top = m.drain().find((e) => e.type === "blob");
  assert.ok(top && Math.abs(top.blob.y0 - w.y1) < 1e-3, `não empilhou (${top && top.blob.y0})`);
});
