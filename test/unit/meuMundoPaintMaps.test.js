// test/unit/meuMundoPaintMaps.test.js — MEU MUNDO 3D: Paint, os MAPAS (mm3d-76)
//
// O catálogo (features/meu-mundo/paint/sim/maps.ts, cópia gerada em
// src/utils/meuMundoPaint.js) tem a Cidade de sempre e mais 5 mapas. Para
// cada mapa novo: 48 gatinhos (18/18/12) e 2×2/3×3 com as rodadas a mais,
// tudo em cima de ilha e longe dos enfeites; ilhas que não se atravessam; o
// lado do time 1 é o espelho do time 0; toda ilha com gatinho é alcançável
// da base com as tintas; a rota de cada time só tem degraus que a cama
// elástica vence; e um ROBÔ sobe a rota inteira (base → portal) só com o que
// o jogo dá. A votação apura o mais votado e sorteia no empate.

const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../../src/utils/meuMundoPaint");

process.removeAllListeners("warning");

const { TUNING: T, PAINT } = P;
const NEW_MAPS = P.PAINT_MAPS.map((m) => m.id).filter((id) => id !== "cidade");

// ── geometria das ilhas ──────────────────────────────────────────────────────

const ptsOf = (isl) => {
  if (isl.poly) {
    const out = [];
    for (let i = 0; i < isl.poly.length; i += 2) out.push([isl.poly[i], isl.poly[i + 1]]);
    return out;
  }
  return Array.from({ length: 24 }, (_, i) => [isl.x + Math.sin((i / 24) * Math.PI * 2) * isl.r, isl.z + Math.cos((i / 24) * Math.PI * 2) * isl.r]);
};
const contains = (isl, x, z, pad = 0) => {
  const s = P.polySolid(ptsOf(isl).flat(), 0, 1);
  for (let i = 0; i < s.d.length; i++) if (s.n[i * 2] * x + s.n[i * 2 + 1] * z - s.d[i] > pad) return false;
  return true;
};
function overlap(a, b) {
  const A = ptsOf(a);
  const B = ptsOf(b);
  for (const poly of [A, B]) {
    for (let i = 0; i < poly.length; i++) {
      const [ax, az] = poly[i];
      const [bx, bz] = poly[(i + 1) % poly.length];
      const nx = bz - az;
      const nz = ax - bx;
      const pa = A.map(([x, z]) => x * nx + z * nz);
      const pb = B.map(([x, z]) => x * nx + z * nz);
      if (Math.max(...pa) < Math.min(...pb) + 1e-6 || Math.max(...pb) < Math.min(...pa) + 1e-6) return false;
    }
  }
  return true;
}
const segDist = (px, pz, ax, az, bx, bz) => {
  const ex = bx - ax;
  const ez = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * ex + (pz - az) * ez) / (ex * ex + ez * ez || 1)));
  return Math.hypot(px - ax - ex * t, pz - az - ez * t);
};
/** Menor distância de borda a borda (0 se se tocam). */
function gap(a, b) {
  if (overlap(a, b)) return 0;
  const A = ptsOf(a);
  const B = ptsOf(b);
  let best = Infinity;
  for (const [P1, P2] of [[A, B], [B, A]]) {
    for (const [x, z] of P1) for (let i = 0; i < P2.length; i++) best = Math.min(best, segDist(x, z, ...P2[i], ...P2[(i + 1) % P2.length]));
  }
  return best;
}
const islandOf = (map, p) => map.islands.find((i) => Math.abs(i.y - p.y) < 1e-6 && contains(i, p.x, p.z, 1e-3));

// ── catálogo e votação ───────────────────────────────────────────────────────

test("paint mapas — catálogo: Cidade primeiro, 6 mapas, id desconhecido vira Cidade", () => {
  assert.equal(P.PAINT_MAPS[0].id, "cidade");
  assert.equal(P.PAINT_MAPS.length, 6, `mapas: ${P.PAINT_MAPS.map((m) => m.id).join(", ")}`);
  assert.equal(P.paintMapId("nada"), "cidade");
  assert.equal(P.buildPaintMap("solo", "nada").id, "cidade");
  for (const m of P.PAINT_MAPS) assert.equal(P.buildPaintMap("solo", m.id).id, m.id);
  // a Cidade é a mesma de antes (o build sem id)
  assert.deepEqual(P.buildPaintMap("1v1"), P.buildPaintMap("1v1", "cidade"));
});

test("paint mapas — votação: mais votado vence; empate sorteia só entre os empatados", () => {
  const ids = P.PAINT_MAPS.map((m) => m.id);
  assert.equal(P.tallyPaintVotes([ids[2], ids[2], ids[1]], 0.99), ids[2]);
  assert.equal(P.tallyPaintVotes([], 0.5), "cidade");
  const seen = new Set();
  for (let r = 0; r < 1; r += 0.05) seen.add(P.tallyPaintVotes([ids[1], ids[3], ids[1], ids[3], "lixo"], r));
  assert.deepEqual([...seen].sort(), [ids[1], ids[3]].sort());
});

// ── desenho de fase ──────────────────────────────────────────────────────────

for (const id of NEW_MAPS) {
  test(`paint mapa ${id} — 48 gatinhos (18/18/12), tudo em cima de ilha e longe dos enfeites`, () => {
    const map = P.buildPaintMap("solo", id);
    assert.equal(map.cats.length, 48);
    assert.equal(new Set(map.cats.map((c) => c.id)).size, 48);
    const onTop = (p) => Math.abs(P.supportAt(map.solids, p.x, p.z, p.y + 0.01) - p.y) < 1e-6;
    for (const c of map.cats) assert.ok(onTop(c), `gatinho ${c.id} no ar`);
    for (const c of map.capsules) assert.ok(onTop(c), `cápsula ${c.id} no ar`);
    for (const b of map.bases) for (const s of b.spawns) assert.ok(onTop(s), "nascimento no ar");
    for (const p of map.portals) assert.ok(onTop(p), "portal no ar");
    for (const s of map.boss.spawns) assert.ok(onTop(s), "nascimento do chefão no ar");
    // longe dos enfeites que colidem (nem dentro de pilar, nem colado)
    for (const it of [...map.cats, ...map.capsules, ...map.bases.flatMap((b) => b.spawns), ...map.portals]) {
      for (const p of map.props) {
        if (Math.abs(p.y - it.y) > 0.01) continue;
        const reach = p.kind === "pillar" ? p.s : Math.hypot(p.w ?? p.s, p.s);
        assert.ok(Math.hypot(it.x - p.x, it.z - p.z) > reach + 0.5, `item em (${it.x}, ${it.z}) dentro de enfeite`);
      }
    }
    const side = (team) => map.cats.filter((c) => islandOf(map, c).team === team).length;
    assert.equal(side(-1), 12, "meio");
    assert.equal(side(0), 18, "time 0");
    assert.equal(side(1), 18, "time 1");
    // os dois portais em cima de uma ilha que não é a base
    for (const p of map.portals) assert.notEqual(islandOf(map, p).kind, "base");
    for (const mode of ["2v2", "3v3"]) {
      const m = P.buildPaintMap(mode, id);
      assert.equal(m.cats.length, 48 * P.PAINT_MODES[mode]);
      for (const c of m.cats) assert.ok(Math.abs(P.supportAt(m.solids, c.x, c.z, c.y + 0.01) - c.y) < 1e-6, `${mode}: gatinho ${c.id} no ar`);
    }
  });

  test(`paint mapa ${id} — ilhas não se atravessam; o time 1 é o espelho do time 0; formas variadas`, () => {
    const map = P.buildPaintMap("solo", id);
    const isl = map.islands.filter((i) => i.kind !== "boss");
    for (const a of isl) {
      assert.ok(a.y >= 0, `ilha ${a.id} abaixo do chão da arena`);
      for (const b of isl) {
        if (a.id >= b.id) continue;
        if (overlap(a, b)) assert.ok(Math.abs(a.y - b.y) >= 4, `ilhas ${a.id}/${b.id} se atravessam (dy ${Math.abs(a.y - b.y)})`);
      }
    }
    const t0 = isl.filter((i) => i.team === 0);
    const t1 = isl.filter((i) => i.team === 1);
    assert.equal(t0.length, t1.length);
    for (const a of t0) assert.ok(t1.some((b) => Math.abs(b.x + a.x) < 1e-3 && Math.abs(b.z - a.z) < 1e-3 && b.y === a.y), `ilha ${a.id} sem espelho`);
    // não é tudo redondo: pelo menos 3 formas diferentes (nº de cantos)
    const shapes = new Set(isl.map((i) => (i.poly ? i.poly.length / 2 : 0)));
    assert.ok(shapes.size >= 3, `formas: ${[...shapes]}`);
    // e sobe de verdade: o portal fica bem acima da base
    assert.ok(map.portals[0].y - map.islands[map.bases[0].island].y >= 22, "pouca subida");
  });

  test(`paint mapa ${id} — toda ilha com gatinho é alcançável da base com as tintas; rota sem degrau impossível`, () => {
    const map = P.buildPaintMap("solo", id);
    const isl = map.islands.filter((i) => i.kind !== "boss");
    // vizinhos: vão até 11 m (ponte) e subida até 5,5 m (cama elástica + pulo no ar)
    const reach = (a, b) => gap(a, b) <= 11 && b.y - a.y <= 5.5;
    for (const team of [0, 1]) {
      const seen = new Set([map.bases[team].island]);
      const q = [map.bases[team].island];
      while (q.length) {
        const a = map.islands[q.shift()];
        for (const b of isl) if (!seen.has(b.id) && reach(a, b)) seen.add(b.id) && q.push(b.id);
      }
      for (const c of map.cats) assert.ok(seen.has(islandOf(map, c).id), `time ${team}: gatinho ${c.id} inalcançável`);
      for (const p of map.portals) assert.ok(seen.has(islandOf(map, p).id), `time ${team}: portal inalcançável`);
      const route = map.routes[team];
      assert.equal(route[0], map.bases[team].island);
      assert.ok(contains(map.islands[route[route.length - 1]], map.portals[team].x, map.portals[team].z), "a rota acaba no portal do time");
      for (let i = 1; i < route.length; i++) {
        const a = map.islands[route[i - 1]];
        const b = map.islands[route[i]];
        assert.ok(b.y - a.y <= 3.8, `rota ${team}: degrau de ${(b.y - a.y).toFixed(2)} m até a ilha ${b.id}`);
        assert.ok(gap(a, b) <= 11, `rota ${team}: vão de ${gap(a, b).toFixed(1)} m até a ilha ${b.id}`);
        assert.ok(gap(a, b) >= 1, `rota ${team}: ilhas ${a.id}/${b.id} grudadas`);
      }
    }
  });
}

// ── robô que sobe a rota ─────────────────────────────────────────────────────

/** Jogador que só usa o corpo e a partida (como o aparelho faria) — o mesmo da Cidade, com ilha de qualquer forma. */
function climber(match, slot) {
  const p = match.players.get(slot);
  const b = P.newBody(p.pose.x, p.pose.y, p.pose.z, p.pose.facing);
  let q = 0;
  const sync = () => match.pose(slot, { x: b.x, y: b.y, z: b.z, facing: b.facing, ground: b.ground, gy: b.gy, e: p.epoch });
  const run = (it, n = 1) => {
    for (let i = 0; i < n; i++) {
      P.stepBody(b, i === 0 ? it : { ...it, jump: false }, match.solids());
      match.tick(T.step);
      sync();
      for (const e of match.drain()) if (e.type === "respawn" && e.slot === slot) Object.assign(b, P.newBody(e.x, e.y, e.z, e.facing));
    }
  };
  const fire = (c, dir) => {
    while (match.time + 0.03 < p.nextFire[c]) run({ mx: 0, mz: 0, run: false, jump: false });
    const o = P.muzzleOf(b, b.facing);
    const before = match.blobs.size;
    match.fire(slot, c, o, dir, ++q);
    const made = match.blobs.size > before ? [...match.blobs.values()].pop() : null;
    if (made && made.owner === slot) P.liftOnto(b, made.blob.x, made.blob.z, made.blob.r, made.blob.y1);
    return made;
  };
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
  /** Distância do centro da ilha até a borda dela na direção (ux, uz). */
  const edgeToward = (isl, ux, uz) => {
    let lo = 0;
    let hi = 60;
    for (let k = 0; k < 30; k++) {
      const m = (lo + hi) / 2;
      if (contains(isl, isl.x + ux * m, isl.z + uz * m)) lo = m;
      else hi = m;
    }
    return lo;
  };
  const hop = (to) => {
    const dx = to.x - b.x;
    const dz = to.z - b.z;
    const d = Math.hypot(dx, dz);
    const ux = dx / d;
    const uz = dz / d;
    const edge = edgeToward(to, -ux, -uz); // a borda de lá virada para cá
    walkTo(b.x + ux * 30, b.z + uz * 30, true);
    b.facing = Math.atan2(to.x - b.x, to.z - b.z);
    let guard = 0;
    for (;;) {
      const reachTo = Math.hypot(to.x - b.x, to.z - b.z) - edge;
      // só as pontes desta altura (as de uma subida anterior, mais baixas, não contam)
      const made = [...match.blobs.values()].filter((x) => x.owner === slot && x.blob.c === PAINT.BRIDGE && Math.abs(x.blob.y1 - b.y) < 0.25);
      const far = made.length ? Math.min(...made.map((x) => Math.hypot(to.x - x.blob.x, to.z - x.blob.z))) : Infinity;
      if (reachTo < 0.5 || far < edge + 0.4) break;
      assert.ok(guard++ < 40, `ponte não chega na ilha ${to.id}`);
      assert.ok(p.ammo[PAINT.BRIDGE] >= 1, `sem munição de ponte indo para a ilha ${to.id}`);
      fire(PAINT.BRIDGE, { x: ux, y: 0, z: uz });
      walkTo(b.x + ux * 30, b.z + uz * 30, true, 40);
    }
    if (to.y > b.y + 0.3) {
      for (let i = 0; i < 400; i++) {
        const g = Math.hypot(to.x - b.x, to.z - b.z) - (edge + 1.4);
        if (Math.abs(g) < 0.12) break;
        const before = { x: b.x, z: b.z };
        const sgn = g > 0 ? 1 : -1;
        run({ mx: ux * sgn * 0.5, mz: uz * sgn * 0.5, run: false, jump: false });
        if (Math.hypot(b.x - before.x, b.z - before.z) < 1e-4) break;
      }
      run({ mx: 0, mz: 0, run: false, jump: false }, 20);
      assert.ok(p.ammo[PAINT.STEP] >= T.cost[PAINT.STEP], `sem munição de cama elástica indo para a ilha ${to.id}`);
      b.facing = Math.atan2(-ux, -uz);
      run({ mx: 0, mz: 0, run: false, jump: false });
      const pad = fire(PAINT.STEP, { x: 0, y: -1, z: 0 });
      assert.ok(pad && pad.blob.c === PAINT.STEP, `a cama elástica não nasceu (ilha ${to.id})`);
      let bounced = false;
      for (let i = 0; i < 300; i++) {
        const toward = bounced ? (b.y > to.y + 0.1 ? 1 : 0) : -1;
        const jump = bounced && !b.ground && b.vy < 1 && b.y < to.y + 0.4 && b.jumps < T.maxJumps;
        run({ mx: ux * toward, mz: uz * toward, run: false, jump });
        if (b.bounce !== null) bounced = true;
        if (bounced && b.ground) break;
      }
      assert.ok(bounced, `não quicou na cama elástica (ilha ${to.id})`);
    }
    walkTo(to.x, to.z, false);
    assert.ok(Math.abs(b.y - to.y) < 0.05 && contains(to, b.x, b.z), `não chegou na ilha ${to.id} (y ${b.y.toFixed(2)} × ${to.y})`);
  };
  const sweep = (isl) => {
    for (const c of match.map.capsules) if (Math.abs(c.y - isl.y) < 0.01 && contains(isl, c.x, c.z)) walkTo(c.x, c.z, true);
    for (const c of match.map.cats) if (Math.abs(c.y - isl.y) < 0.01 && contains(isl, c.x, c.z)) walkTo(c.x, c.z, true);
    walkTo(isl.x, isl.z, false);
  };
  return { b, p, hop, sweep };
}

for (const id of NEW_MAPS) {
  for (const team of [0, 1]) {
    test(`paint mapa ${id} — robô do time ${team} sobe a rota inteira, da base ao portal`, () => {
      const match = new P.PaintMatch(
        "1v1",
        [
          { slot: 0, team: 0, sit: 0 },
          { slot: 1, team: 1, sit: 0 },
        ],
        P.buildPaintMap("1v1", id),
      );
      match.tick(T.countdown + 0.01);
      assert.equal(match.phase, "play");
      const bot = climber(match, team);
      const route = match.map.routes[team].map((i) => match.map.islands[i]);
      bot.sweep(route[0]);
      for (const isl of route.slice(1)) {
        bot.hop(isl);
        bot.sweep(isl);
      }
      const top = route[route.length - 1];
      assert.ok(Math.abs(bot.b.y - top.y) < 0.05, "não terminou no alto");
      assert.ok(bot.p.cats >= 6, `gatinhos no caminho: ${bot.p.cats}`);
    });
  }
}
