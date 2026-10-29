// test/unit/meuMundoCorrida.test.js — MEU MUNDO 3D: Corrida antigravidade (mm3d-39b)
//
// A regra mora no front (features/meu-mundo/corrida/sim/*.ts) e o back roda a
// cópia GERADA (src/utils/meuMundoCorrida.js). Aqui: a cópia está em dia; a
// pista fecha e os dois vãos se vencem acelerando; uma corrida sozinho (robô
// no lugar do jogador) termina com as 6 naves; em grupo, o servidor (jogadores
// remotos + computadores) e dois aparelhos trocando o estado chegam na MESMA
// ordem; quem sai no meio vai para o fim e a sala encerra; a cápsula é de
// quem pede primeiro.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const C = require("../../src/utils/meuMundoCorrida");

process.removeAllListeners("warning");

const track = C.buildTrack(C.BAIA);
const IDLE = { steer: 0, throttle: 0, brake: 0, turbo: false };

test("corrida — a cópia do back está em dia com o front", (t) => {
  const gen = require("../../scripts/build-corrida-sim");
  if (!fs.existsSync(gen.SIM)) return t.skip("front fora do lugar");
  const cur = fs.readFileSync(gen.OUT, "utf8").replace(/\r\n/g, "\n");
  assert.equal(cur, gen.build(), "rode node scripts/build-corrida-sim.js");
});

test("corrida — pista: volta de ~2 km, dois vãos com rampa antes", () => {
  assert.ok(track.length > 1800 && track.length < 2400, String(track.length));
  assert.equal(track.gaps.length, 2);
  for (const g of track.gaps) assert.ok(g.ramp > 30 && g.s1 > g.s0, JSON.stringify(g));
  assert.ok(track.pads.length >= 5 && track.orbs.length >= 8);
});

test("corrida — o vão grande: acelerando passa, devagar e sem acelerar cai", () => {
  const jump = (v, throttle) => {
    const race = new C.Race({ track, rivals: 0 });
    race.time = 0;
    race.phase = "race";
    const g = track.gaps[1];
    const c = race.player;
    const p = C.trackAt(track, g.s0 - g.ramp - 20);
    Object.assign(c, { dist: g.s0 - g.ramp - 20, v, u: 0, yaw: p.yaw, Y: p.y });
    const ev = [];
    for (let k = 0; k < 120 * 14; k++) {
      race.step({ ...IDLE, throttle }, ev);
      if (ev.some((e) => e.type === "fell")) return "caiu";
      if (ev.some((e) => e.type === "land")) return "pousou";
      ev.length = 0;
    }
    return "nada";
  };
  assert.equal(jump(40, 1), "pousou");
  assert.equal(jump(90, 0), "pousou");
  assert.equal(jump(40, 0), "caiu");
});

test("corrida — sozinho: as 6 naves completam as 3 voltas e a corrida acaba", () => {
  const race = new C.Race({ track, rivals: 5, seed: 3 });
  const ev = [];
  for (let k = 0; race.phase !== "end" && k < 120 * 300; k++) {
    race.step(race.drive(race.player), ev);
    ev.length = 0;
  }
  assert.equal(race.phase, "end");
  for (const c of race.cars) assert.equal(c.laps.length, 3, c.name);
});

test("corrida — em grupo: servidor e dois aparelhos chegam na mesma ordem", () => {
  const kinds = ["remote", "remote", "bot", "bot", "bot", "bot"];
  const server = new C.Race({ track, seats: kinds.map((k, i) => ({ name: i < 2 ? `P${i}` : "", kind: k })), me: -1 });
  const clients = [0, 1].map(
    (me) => new C.Race({ track, seats: server.cars.map((c, i) => ({ name: c.name, kind: i === me ? "local" : "remote" })), me, autoEnd: false })
  );
  const ev = [];
  let claims = 0;
  for (let k = 0; server.phase !== "end" && k < 120 * 300; k++) {
    server.step(IDLE, ev);
    ev.length = 0;
    for (const c of clients) {
      // o aparelho sabe das cápsulas que já saíram (o estado da sala)
      for (const [id, left] of server.orbOut) c.orbOut.set(id, left);
      c.step(c.drive(c.player), ev);
      for (const e of ev) {
        if (e.type !== "orb" || e.car !== c.me) continue
        claims++;
        if (!server.claimOrb(c.me, e.orb, [])) c.player.charges = Math.max(0, c.player.charges - 1);
      }
      ev.length = 0;
    }
    if (k % 6 === 0) {
      for (const c of clients) server.applyRemote(c.me, c.remoteOf(c.player), ev);
      for (const c of clients) for (const car of server.cars) if (car.id !== c.me) c.applyRemote(car.id, server.remoteOf(car), ev);
      ev.length = 0;
    }
  }
  assert.equal(server.phase, "end");
  assert.ok(claims > 0);
  const order = (r) => r.standings().map((c) => c.id).join(",");
  assert.equal(order(clients[0]), order(server));
  assert.equal(order(clients[1]), order(server));
  for (const c of server.cars) assert.ok(c.finished !== null, c.name);
});

test("corrida — quem sai no meio vai para o fim; todos saem = a sala encerra", () => {
  const race = new C.Race({ track, seats: [{ name: "A", kind: "remote" }, { name: "B", kind: "remote" }, ...Array.from({ length: 4 }, () => ({ name: "", kind: "bot" }))], me: -1 });
  const ev = [];
  for (let i = 0; i < 120 * 10; i++) race.step(IDLE, ev);
  race.markGone(0);
  assert.equal(race.standings().slice(-1)[0].name, "A");
  assert.equal(race.phase, "race");
  race.markGone(1);
  for (let i = 0; race.phase !== "end" && i < 120 * 30; i++) race.step(IDLE, ev);
  assert.equal(race.phase, "end", "sem jogador, a corrida acaba logo depois (os computadores não seguram a sala)");
});

test("corrida — cápsula: quem pede primeiro leva; longe demais não leva", () => {
  const race = new C.Race({ track, seats: [{ name: "A", kind: "remote" }, { name: "B", kind: "remote" }], me: -1 });
  race.phase = "race";
  race.time = 1;
  const o = track.orbs[0];
  race.cars[0].dist = o.s;
  race.cars[1].dist = o.s;
  assert.equal(race.claimOrb(0, o.id, []), true);
  assert.equal(race.claimOrb(1, o.id, []), false);
  const o2 = track.orbs[3];
  race.cars[1].dist = o2.s + 400;
  assert.equal(race.claimOrb(1, o2.id, []), false);
});

test("corrida — garagem (mm3d-49): as naves são equilibradas e cabem no limite da sala", () => {
  assert.equal(C.SHIPS[0].id, C.DEFAULT_SHIP);
  for (const s of C.SHIPS) {
    const d = s.speed + s.accel + s.turn + s.turbo - 4;
    assert.ok(Math.abs(d) < 1e-9, `${s.id}: desvios somam ${d}`);
    for (const k of ["speed", "accel", "turn", "turbo"]) assert.ok(Math.abs(s[k] - 1) <= 0.1, `${s.id}.${k}`);
    // a sala recusa acima de 1,2× o turbo
    assert.ok(s.speed <= 1.05, s.id);
  }
  assert.equal(C.shipOf("nao-existe").id, C.DEFAULT_SHIP);
});

test("corrida — garagem: a nave do lugar muda o teto de velocidade", () => {
  const top = (ship) => {
    const race = new C.Race({ track, seats: [{ name: "A", kind: "local", ship }], rivals: 0 });
    race.time = 0;
    race.phase = "race";
    let v = 0;
    for (let i = 0; i < 120 * 12; i++) {
      race.step({ steer: 0, throttle: 1, brake: 0, turbo: false }, []);
      v = Math.max(v, race.player.v);
    }
    assert.equal(race.player.ship, ship);
    return v;
  };
  const fast = top("corisco");
  const base = top("brasa");
  const slow = top("tita");
  assert.ok(fast > base && base > slow, `${fast} > ${base} > ${slow}`);
});

test("corrida — garagem: sem nave na vaga, cada lugar pega uma (o servidor manda a de cada um)", () => {
  const race = new C.Race({ track, rivals: 5 });
  assert.deepEqual(
    race.cars.map((c) => c.ship),
    C.SHIPS.map((s) => s.id),
  );
});
