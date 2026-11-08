// test/unit/meuMundoPaintMorkhan.test.js — MEU MUNDO 3D: Paint, B11
//
// O Morkhan persegue quem completa os 20 gatinhos do time (regra no front,
// features/meu-mundo/paint/sim/morkhan.ts + match.ts; aqui a cópia GERADA,
// a mesma que a sala roda). Confere: surge no 20º gatinho atrás de quem
// completou; corre atrás e golpeia com o empurrão do muro (sem dano); quem
// cai devolve os gatinhos ao mapa, renasce na base e o portal fecha; quem
// entra no portal vence e ele some; segue o rastro e só salta onde a pessoa
// saltou — nunca anda sobre o vazio — nos 6 mapas.

const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../../src/utils/meuMundoPaint");

process.removeAllListeners("warning");

const { TUNING: T } = P;
const M = T.morkhan;
const DT = 0.05;

function solo(mapId = "cidade") {
  const m = new P.PaintMatch("solo", [{ slot: 0, team: 0, sit: 0 }], P.buildPaintMap("solo", mapId));
  m.tick(T.countdown + 0.01);
  m.drain();
  return m;
}

const place = (m, slot, x, y, z, facing = 0, ground = true) => {
  const p = m.players.get(slot);
  p.pose = { x, y, z, facing, ground, gy: y, e: p.epoch };
};

/** Chão firme no ponto (topo de ilha a menos de 1 cm). */
const topAt = (m, x, z, y) => P.supportAt(m.map.solids, x, z, y + 0.01, 0);

/** Anda em linha reta (no chão) de `a` até `b`, deixando o rastro. */
function walk(m, slot, a, b, events = []) {
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(1, Math.ceil(d / (T.run * DT)));
  const f = Math.atan2(b.x - a.x, b.z - a.z);
  for (let i = 1; i <= n; i++) {
    const u = i / n;
    place(m, slot, a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, a.z + (b.z - a.z) * u, f);
    m.tick(DT);
    events.push(...m.drain());
  }
  return events;
}

/** Um ponto firme a ~`r` m do nascimento, na mesma ilha. */
function farSpot(m, from, r) {
  for (let k = 0; k < 64; k++) {
    const a = (k / 64) * Math.PI * 2;
    const ok = (rr) => {
      for (let s = 0.5; s <= rr; s += 0.5) if (Math.abs(topAt(m, from.x + Math.sin(a) * s, from.z + Math.cos(a) * s, from.y) - from.y) > 1e-3) return false;
      return true;
    };
    if (ok(r)) return { x: from.x + Math.sin(a) * r, y: from.y, z: from.z + Math.cos(a) * r };
  }
  return null;
}

/** Dá 19 gatinhos ao jogador (ids que não vão ser pisados) e deixa o 20º no ponto `c`. */
function nineteen(m, slot, keep) {
  const p = m.players.get(slot);
  const ids = m.map.cats.filter((c) => c.id !== keep.id).slice(0, T.catsToPortal - 1).map((c) => c.id);
  for (const id of ids) m.catsTaken.set(id, p.team);
  p.cats = ids.length;
  p.catIds = ids.slice();
  m.teamCats[p.team] = ids.length;
}

test("B11 — o Morkhan surge no 20º gatinho, atrás de quem completou", () => {
  const m = solo();
  const cat = m.map.cats[0];
  nineteen(m, 0, cat);
  // chega andando ao gatinho (deixa rastro)
  const start = farSpot(m, cat, 6) || cat;
  place(m, 0, start.x, start.y, start.z);
  m.tick(DT);
  m.drain();
  const ev = walk(m, 0, start, cat);
  assert.ok(ev.find((e) => e.type === "portal" && e.team === 0), "o portal não abriu");
  const on = ev.find((e) => e.type === "morkhan" && e.on);
  assert.ok(on && on.slot === 0 && on.why === "cats", JSON.stringify(on));
  assert.equal(m.chased(0), 0);
  const mk = m.morkhans[0];
  assert.equal(mk.act, "rise");
  // nasce no rastro, atrás (nunca em cima de quem caça)
  assert.ok(Math.hypot(mk.x - cat.x, mk.z - cat.z) > 1, "nasceu em cima");
  assert.ok(Math.abs(topAt(m, mk.x, mk.z, mk.y) - mk.y) < 0.8, "nasceu no ar");
  // com 19 nada acontece: só o 20º o chama
  const m2 = solo();
  m2.tick(1);
  assert.equal(m2.chased(0), -1);
});

test("B11 — corre atrás, alcança e golpeia com o empurrão do muro (sem dano)", () => {
  const m = solo();
  const base = m.map.bases[0].spawns[0];
  const far = farSpot(m, base, 7);
  assert.ok(far, "base sem 7 m de chão");
  place(m, 0, base.x, base.y, base.z);
  m.tick(DT);
  walk(m, 0, base, far);
  // dispara (o mesmo caminho do 20º gatinho)
  m.teamCats[0] = T.catsToPortal;
  m.checkPortal(m.players.get(0));
  assert.equal(m.chased(0), 0);
  // parado: ele surge, espera `rise`, corre e golpeia
  let hit = null;
  let ran = false;
  for (let i = 0; i < 200 && !hit; i++) {
    m.tick(DT);
    if (m.morkhans[0].act === "run" || m.morkhans[0].act === "dash") ran = true;
    hit = m.drain().find((e) => e.type === "hit" && e.how === "morkhan") || null;
  }
  assert.ok(ran, "não correu");
  assert.ok(hit, "não golpeou");
  assert.equal(hit.slot, 0);
  assert.equal(hit.hp, T.hpMax, "o golpe dele não tira sangue");
  assert.equal(m.players.get(0).hp, T.hpMax);
  assert.ok(Math.abs(Math.hypot(hit.kx, hit.kz) - T.wallShove) < 1e-6, "empurrão = o do muro");
  assert.equal(hit.ky, T.wallShoveLift);
  // não golpeia antes de surgir de todo
  assert.ok(m.time >= M.rise);
});

test("B11 — velocidade: 90% da corrida, com arrancada curta", () => {
  assert.ok(Math.abs(M.speed - T.run * 0.9) < 1e-9);
  assert.ok(M.dashK > 1 && M.dashDur < M.dashEvery);
  // num corredor reto e firme, sem arrancada ele anda speed·dt por passo
  const solids = [{ k: 1, x: 0, z: 30, y0: -1, y1: 0, hx: 2, hz: 40 }];
  const s = P.newMorkhan(0);
  const trail = [];
  for (let z = 0; z <= 40; z += 0.6) P.morkhanTrailAdd(trail, 0, 0, z);
  P.morkhanSpawn(s, 0, trail, { x: 0, y: 0, z: 40 }, 0);
  const tgt = { x: 0, y: 0, z: 40, ground: true };
  s.nextDash = 1e9;
  let t = M.rise;
  P.morkhanStep(s, tgt, solids, DT, t);
  const z0 = s.z;
  for (let i = 0; i < 20; i++) P.morkhanStep(s, tgt, solids, DT, (t += DT));
  assert.ok(Math.abs(s.z - z0 - M.speed * DT * 20) < 0.05, `andou ${s.z - z0}`);
  // com arrancada, mais longe
  const s2 = P.newMorkhan(0);
  P.morkhanSpawn(s2, 0, trail, { x: 0, y: 0, z: 40 }, 0);
  let t2 = M.rise;
  s2.nextDash = t2;
  P.morkhanStep(s2, tgt, solids, DT, t2);
  const z1 = s2.z;
  for (let i = 0; i < 20; i++) P.morkhanStep(s2, tgt, solids, DT, (t2 += DT));
  assert.ok(s2.z - z1 > M.speed * DT * 20 * 1.2, "a arrancada não acelerou");
});

test("B11 — caiu da ilha: os gatinhos voltam ao mapa, renasce na base, o Morkhan some e o portal fecha", () => {
  const m = solo();
  const cat = m.map.cats[0];
  nineteen(m, 0, cat);
  const start = farSpot(m, cat, 4) || cat;
  place(m, 0, start.x, start.y, start.z);
  m.tick(DT);
  walk(m, 0, start, cat);
  assert.equal(m.chased(0), 0);
  const carried = [...m.players.get(0).catIds];
  assert.equal(carried.length, T.catsToPortal);
  // jogado da ilha: cai abaixo das nuvens
  place(m, 0, cat.x, T.fallY - 1, cat.z, 0, false);
  m.tick(DT);
  const ev = m.drain();
  const p = m.players.get(0);
  assert.ok(ev.find((e) => e.type === "drop" && e.slot === 0 && e.n === T.catsToPortal));
  assert.deepEqual(ev.filter((e) => e.type === "catBack").map((e) => e.id).sort((a, b) => a - b), carried.sort((a, b) => a - b));
  for (const id of carried) assert.ok(!m.catsTaken.has(id), `gatinho ${id} não voltou`);
  assert.equal(p.cats, 0);
  assert.equal(m.teamCats[0], 0);
  const sp = m.map.bases[0].spawns[0];
  assert.ok(Math.hypot(p.pose.x - sp.x, p.pose.z - sp.z) < 1e-6 && p.pose.y === sp.y, "não renasceu no início");
  const off = ev.find((e) => e.type === "morkhan" && !e.on);
  assert.ok(off && off.why === "fell", JSON.stringify(off));
  assert.equal(m.chased(0), -1);
  assert.ok(!m.portalOpen[0] && ev.find((e) => e.type === "portalShut" && e.team === 0), "o portal não fechou");
  // juntou de novo: o portal abre e ele volta
  nineteen(m, 0, cat);
  place(m, 0, cat.x, cat.y, cat.z);
  m.tick(DT);
  const again = m.drain();
  assert.ok(again.find((e) => e.type === "portal"));
  assert.ok(again.find((e) => e.type === "morkhan" && e.on));
});

test("B11 — chegou ao portal: entra no Guardião, o Morkhan some e o portal segue aberto", () => {
  const m = solo();
  const cat = m.map.cats[0];
  nineteen(m, 0, cat);
  place(m, 0, cat.x, cat.y, cat.z);
  m.tick(DT);
  m.drain();
  assert.equal(m.chased(0), 0);
  const portal = m.map.portals[0];
  place(m, 0, portal.x, portal.y, portal.z);
  m.tick(DT);
  const ev = m.drain();
  assert.ok(m.players.get(0).inBoss, "não entrou");
  const off = ev.find((e) => e.type === "morkhan" && !e.on);
  assert.ok(off && off.why === "portal", JSON.stringify(off));
  assert.equal(m.chased(0), -1);
  assert.ok(m.portalOpen[0], "o portal fechou");
  assert.ok(!ev.find((e) => e.type === "portalShut"));
});

test("B11 — nocaute de outro jogador: os gatinhos vão para quem derrubou e o Morkhan troca de caça", () => {
  const m = new P.PaintMatch("1v1", [
    { slot: 0, team: 0, sit: 0 },
    { slot: 1, team: 1, sit: 0 },
  ]);
  m.tick(T.countdown + 0.01);
  m.drain();
  const cat = m.map.cats[0];
  nineteen(m, 0, cat);
  place(m, 0, cat.x, cat.y, cat.z);
  m.tick(DT);
  m.drain();
  assert.equal(m.chased(0), 0);
  // o outro derruba (sangue a zero)
  const v = m.players.get(0);
  v.hp = T.harmDmg;
  m.damage(0, 1, "harm");
  const ev = m.drain();
  assert.ok(ev.find((e) => e.type === "steal" && e.to === 1));
  assert.ok(ev.find((e) => e.type === "morkhan" && !e.on && e.why === "ko" && e.team === 0));
  assert.ok(!m.portalOpen[0], "o portal de quem caiu fecha");
  // quem roubou completou os 20 do time dele: agora é ele o caçado
  assert.ok(m.portalOpen[1]);
  assert.equal(m.chased(1), 1);
});

test("B11 — não atravessa o vazio: chão contínuo anda, vão só salta onde a pessoa saltou", () => {
  // duas ilhas com um vão de 6 m
  const solids = [
    { k: 0, x: 0, z: 0, y0: -2, y1: 0, r: 4 },
    { k: 0, x: 0, z: 14, y0: -2, y1: 0, r: 4 },
  ];
  assert.ok(P.morkhanFlat(solids, { x: 0, y: 0, z: -3 }, { x: 0, y: 0, z: 3 }));
  assert.ok(!P.morkhanFlat(solids, { x: 0, y: 0, z: 3 }, { x: 0, y: 0, z: 11 }), "atravessou o vão");
  // ela pulou de z=3 para z=11 (sem pontos no meio): ele salta exatamente ali
  const trail = [];
  for (let z = -3; z <= 3.01; z += 0.6) P.morkhanTrailAdd(trail, 0, 0, z);
  P.morkhanTrailAdd(trail, 0, 0, 11);
  for (let z = 11.6; z <= 15; z += 0.6) P.morkhanTrailAdd(trail, 0, 0, z);
  const s = P.newMorkhan(0);
  P.morkhanSpawn(s, 0, trail, { x: 0, y: 0, z: 15 }, 0);
  s.x = 0;
  s.z = -3;
  s.path = trail.slice(1).map((p) => ({ ...p }));
  const tgt = { x: 0, y: 0, z: 15, ground: true };
  let t = M.rise;
  let leaped = null;
  for (let i = 0; i < 200; i++) {
    P.morkhanStep(s, tgt, solids, DT, (t += DT));
    if (s.act === "leap" && !leaped) leaped = { ...s.leap };
    if (s.act !== "leap") assert.ok(P.supportAt(solids, s.x, s.z, s.y + 0.01, 0) > -1, `no vazio em z=${s.z.toFixed(2)}`);
    if (s.act === "strike") break;
  }
  assert.ok(leaped, "não saltou");
  assert.ok(leaped.z0 <= 3.01 && leaped.z1 >= 10.99, `saltou de ${leaped.z0} para ${leaped.z1}`);
  assert.ok(s.z > 11, "não chegou ao outro lado");
  // sem rastro do outro lado (ela está lá, mas ele não sabe o caminho): espera na borda
  const s2 = P.newMorkhan(0);
  P.morkhanSpawn(s2, 0, trail.slice(0, 11), { x: 0, y: 0, z: 15 }, 0);
  let t2 = M.rise;
  for (let i = 0; i < 100; i++) P.morkhanStep(s2, tgt, solids, DT, (t2 += DT));
  assert.ok(s2.z < 4 && s2.act === "wait", `andou no vazio: z=${s2.z} ${s2.act}`);
});

test("B11 — nos 6 mapas: segue a rota de ilhas pelo rastro e alcança quem caça, sem pisar no vazio", () => {
  for (const def of P.PAINT_MAPS) {
    const m = solo(def.id);
    const map = m.map;
    // o rastro: os centros das ilhas da rota do time 0 (que têm chão no centro)
    const pts = [];
    for (const id of map.routes[0]) {
      const isl = map.islands[id];
      if (Math.abs(topAt(m, isl.x, isl.z, isl.y) - isl.y) < 1e-3) pts.push({ x: isl.x, y: isl.y, z: isl.z });
    }
    // quem caça fica antes do portal (no portal ela venceria)
    const portal = map.portals[0];
    while (pts.length && Math.hypot(pts[pts.length - 1].x - portal.x, pts[pts.length - 1].z - portal.z) < 4) pts.pop();
    assert.ok(pts.length >= 3, `${def.id}: rota curta`);
    const p = m.players.get(0);
    p.trail = [];
    for (const q of pts) P.morkhanTrailAdd(p.trail, q.x, q.y, q.z);
    const end = pts[pts.length - 1];
    place(m, 0, end.x, end.y, end.z);
    m.teamCats[0] = T.catsToPortal;
    m.checkPortal(p);
    assert.equal(m.chased(0), 0, def.id);
    const mk = m.morkhans[0];
    let hit = false;
    for (let i = 0; i < 1200 && !hit; i++) {
      place(m, 0, end.x, end.y, end.z);
      m.tick(DT);
      hit = !!m.drain().find((e) => e.type === "hit" && e.how === "morkhan");
      if (mk.act !== "leap" && mk.act !== "gone") {
        const g = P.supportAt(m.solids(), mk.x, mk.z, mk.y + 0.75, 0);
        assert.ok(g > mk.y - 0.75, `${def.id}: Morkhan no vazio em (${mk.x.toFixed(1)}, ${mk.y.toFixed(1)}, ${mk.z.toFixed(1)}) ${mk.act}`);
      }
    }
    assert.ok(hit, `${def.id}: não alcançou (${mk.act} em ${mk.x.toFixed(1)},${mk.y.toFixed(1)},${mk.z.toFixed(1)})`);
  }
});
