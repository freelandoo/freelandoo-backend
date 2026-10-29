// test/meu-mundo-corrida.e2e.js — MEU MUNDO 3D: Corrida antigravidade em grupo (mm3d-39b)
//
// Roda: TEST_DATABASE_URL=postgres://...localhost.../mm npm run test:meu-mundo-corrida
//
// ⚠️ NÃO APONTA PARA PRODUÇÃO (recusa host que não seja local): cria num banco
// descartável o esqueleto mínimo e usuários SIMULADOS ("mmtest_*"). Os
// clientes são WebSocket reais do @colyseus/sdk.
//
// Prova: só entra no centro e perto da porta; quem chega na espera cai na
// MESMA largada; passou o prazo, a sala tranca e completa 6 naves com o
// computador (2 pessoas = 4 computadores), quem chega depois vai para outra
// largada; "start" diz a nave de cada um; sozinho depois do prazo = 5
// computadores; as naves chegam a 20 Hz; pose impossível é limitada; cápsula
// é de quem pede primeiro (o outro recebe "deny"); quem sai no meio vira
// "não terminou"; 3 voltas = chegada e resultado no estado e a sala fecha;
// 6 pessoas largam na hora; voltar para casa tira da corrida.

const url = process.env.TEST_DATABASE_URL;
if (!url || !/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("TEST_DATABASE_URL precisa apontar para um Postgres LOCAL e descartável.");
  process.exit(2);
}
process.env.DATABASE_URL = url;
process.env.DATABASE_SSL = "false";

const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");

let PASS = 0;
let FAIL = 0;
function check(label, cond, extra = "") {
  if (cond && typeof cond.then === "function") throw new Error(`await antes: ${label}`);
  if (cond) {
    PASS++;
    console.log(`✓ ${label}`);
  } else {
    FAIL++;
    console.log(`✗ ${label}${extra ? " — " + extra : ""}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bye = (room, consented = true) => Promise.race([room.leave(consented).catch(() => {}), sleep(400)]);
async function until(fn, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await sleep(15);
  }
  return false;
}

const MIGS = [
  "291_meu_mundo_bairros",
  "292_meu_mundo_house_levels",
  "293_meu_mundo_visits",
  "294_meu_mundo_body_sergio",
  "295_meu_mundo_vida",
  "297_meu_mundo_atributos_1000",
  "298_meu_mundo_atributos_inicio_baixo",
  "299_meu_mundo_vehicles",
  "300_meu_mundo_skins",
  "301_meu_mundo_geladeira",
  "302_meu_mundo_inbox",
  "304_meu_mundo_avatar_colors",
  "308_meu_mundo_lugar_atividade",
  "309_meu_mundo_vendedor",
  "311_meu_mundo_boxe",
];
const TABLES = `tb_mm_car_paint_owned, tb_mm_consume_key, tb_mm_pantry, tb_mm_skin_owned, tb_mm_character_event, tb_mm_character_day, tb_mm_character, tb_mm_wallet, tb_mm_vehicle, tb_mm_visit,
  tb_mm_avatar_pref, tb_mm_residence, tb_mm_house, tb_mm_lot, tb_mm_neighborhood, tb_user_role, tb_role, tb_user`;
async function bootstrap(pool) {
  await pool.query(`DROP TABLE IF EXISTS ${TABLES} CASCADE`);
  await pool.query(`CREATE TABLE tb_user (id_user UUID PRIMARY KEY, username TEXT, email TEXT)`);
  await pool.query(`CREATE TABLE tb_role (id_role SERIAL PRIMARY KEY, desc_role TEXT, is_active BOOLEAN DEFAULT TRUE)`);
  await pool.query(`CREATE TABLE tb_user_role (id_user UUID, id_role INT, is_active BOOLEAN DEFAULT TRUE)`);
  await pool.query(`INSERT INTO tb_role (desc_role) VALUES ('Administrator')`);
  await require("./helpers/mmPolens").polenTables(pool);
  for (const m of MIGS) await pool.query(fs.readFileSync(path.join(__dirname, `../src/databases/migrations/${m}.sql`), "utf8"));
}

async function mkUser(pool, tag) {
  const id = crypto.randomUUID();
  await pool.query(`INSERT INTO tb_user VALUES ($1, $2, $3)`, [id, `mmtest_${tag}`, `${id}@mm.test`]);
  await pool.query(`INSERT INTO tb_user_role (id_user, id_role) VALUES ($1, 1)`, [id]);
  return id;
}

(async () => {
  const pool = require("../src/databases");
  await bootstrap(pool);
  const Storage = require("../src/storages/MeuMundoStorage");
  const express = require("express");
  const realtime = require("../src/realtime/meuMundo");
  const corrida = require("../src/realtime/meuMundoCorrida");
  const presence = require("../src/realtime/meuMundoPresence");
  const Service = require("../src/services/MeuMundoService");
  const Center = require("../src/utils/meuMundoCenter");
  corrida._corridaTiming.lobbyMs = 1200;
  corrida._corridaTiming.closeMs = 500;

  // 10 administradores: 9 no centro, 1 na rua.
  const users = [];
  for (let i = 0; i < 10; i++) users.push(await mkUser(pool, `c${i}`));
  for (const u of users) await Storage.ensureResidence(pool, u);

  const server = http.createServer(express());
  await new Promise((r) => server.listen(0, r));
  realtime.init(server);
  const port = server.address().port;
  const { Client } = await import("@colyseus/sdk");
  const client = new Client(`ws://127.0.0.1:${port}/mm-ws`);
  const consume = (out) => client.consumeSeatReservation(out.multiplayer.reservation);

  const live = new Map();
  for (const u of users) live.set(u, { nb: await consume(await Service.enter(u)) });
  for (const u of users.slice(0, 9)) {
    const out = await Service.travelToCenter(u);
    if (out.error) throw new Error(out.error);
    const room = await consume(out);
    await bye(live.get(u).nb);
    live.set(u, { center: room });
  }
  const DOOR = Center.PLACES.find((p) => p.id === "corrida").interact;
  function nearDoor(u, dx = 0) {
    const here = presence.get(u);
    const room = realtime._centerRooms().find((r) => r.roomId === here.id);
    const s = [...room.sim.values()].find((x) => x.userId === u);
    Object.assign(s.body, { x: DOOR.x + dx, z: DOOR.z });
  }
  async function join(u, ship) {
    const out = await Service.joinCorrida(u, { ship });
    if (out.error) return { out };
    const room = await consume(out);
    const box = { out, room, welcome: null, start: null, snaps: 0, last: null, deny: [], replaced: false, code: null };
    room.onMessage("welcome", (m) => (box.welcome = m));
    room.onMessage("start", (m) => (box.start = m));
    room.onMessage("s", (m) => {
      box.snaps++;
      box.last = m;
    });
    room.onMessage("deny", (m) => box.deny.push(m.orb));
    room.onMessage("replaced", () => (box.replaced = true));
    room.onMessage("pong", () => {});
    room.onLeave((code) => (box.code = code));
    await until(() => box.welcome);
    return box;
  }
  const roomOf = (id) => corrida._corridaRooms().find((r) => r.roomId === id);
  const pose = (box, car, extra = {}) => box.room.send("p", { d: car.dist, u: car.u, y: car.Y, w: car.yaw, v: car.v, vy: 0, f: 0, s: 0, th: 1, ...extra });

  // ── Quem pode entrar ──────────────────────────────────────────────────────
  check("o centro tem a Corrida como minijogo", Center.PLACES.find((p) => p.id === "corrida").destination === "game:corrida");
  const far = await Service.joinCorrida(users[0]);
  check("longe da porta: 409 far", far.statusCode === 409 && far.code === "far", JSON.stringify(far));
  const street = await Service.joinCorrida(users[9]);
  check("fora do centro: 409", street.statusCode === 409);
  for (let i = 0; i < 9; i++) nearDoor(users[i]);

  // ── Espera de 1 minuto (encurtada) e computadores completando ────────────
  const A = await join(users[0], "vespa");
  check("o 1º fica esperando, com o prazo da espera", A.room.state.phase === "lobby" && A.welcome.until > Date.now());
  const B = await join(users[1], "nave-que-nao-existe");
  check("o 2º cai na mesma largada", B.room.roomId === A.room.roomId);
  check("passou o prazo: larga (contagem)", await until(() => A.room.state.phase === "countdown", 4000));
  check("start: cada um com a sua nave", (await until(() => A.start && B.start)) && A.start.me === 0 && B.start.me === 1);
  const humans = A.start.seats.filter((s) => s.human).length;
  check("6 naves: 2 pessoas + 4 computadores", A.start.seats.length === 6 && humans === 2, JSON.stringify(A.start.seats));
  // garagem (mm3d-49): cada um com a nave que escolheu; desconhecida = a padrão; computadores com as que sobraram
  const ships = A.start.seats.map((s) => s.ship);
  check("garagem: a nave escolhida vai na largada", ships[0] === "vespa" && ships[1] === "brasa", JSON.stringify(ships));
  check("…os computadores pegam as que sobraram", new Set(ships.slice(2)).size === 4 && ships.slice(2).every((x) => x !== "vespa" && x !== "brasa"), JSON.stringify(ships));
  check("…e o servidor corre com os status dela", roomOf(A.room.roomId).race.cars[0].stats.speed === 1.03);
  const Cx = await join(users[2]);
  check("trancada: quem chega depois vai para outra largada", Cx.room && Cx.room.roomId !== A.room.roomId && Cx.room.state.phase === "lobby");
  check("sozinho depois do prazo: 1 pessoa + 5 computadores", (await until(() => Cx.start, 4000)) && Cx.start.seats.filter((s) => !s.human).length === 5);
  await bye(Cx.room);

  const r = roomOf(A.room.roomId);
  r.race.time = -0.01; // pula a contagem
  check("corrida começa", await until(() => A.room.state.phase === "race"));
  check("as naves chegam a ~20 Hz", (await until(() => A.snaps >= 10, 2000)) && A.last.c.length === 6 * 9);
  const bots0 = r.race.cars.slice(2).map((c) => c.dist);
  await sleep(500);
  check("os computadores correm", r.race.cars.slice(2).every((c, i) => c.dist > bots0[i] + 5));

  // pose: normal passa, impossível é limitada
  const ca = r.race.cars[0];
  const start = ca.dist;
  pose(A, { ...ca, dist: start + 20, v: 40 });
  check("pose normal: a sala acompanha", await until(() => Math.abs(r.race.cars[0].dist - (start + 20)) < 0.01));
  pose(A, { ...ca, dist: start + 5000, v: 40 });
  await until(() => r.race.cars[0].dist > start + 21);
  check("pose impossível (5 km de uma vez): limitada", r.race.cars[0].dist < start + 800, String(r.race.cars[0].dist - start));

  // cápsula: quem pede primeiro leva
  const orb = r.race.track.orbs.find((o) => !r.race.orbOut.has(o.id));
  const L = r.race.track.length;
  // as duas naves andam até a cápsula à frente, em passos possíveis
  const target = Math.max(r.race.cars[0].dist, r.race.cars[1].dist) - orb.s;
  const goalOrb = (Math.floor(target / L) + 1) * L + orb.s;
  for (const [box, i] of [[A, 0], [B, 1]]) {
    let x = r.race.cars[i].dist;
    while (x < goalOrb) {
      x = Math.min(goalOrb, x + 150);
      pose(box, { ...r.race.cars[i], dist: x, u: orb.u, v: 30 });
      await sleep(40);
    }
  }
  await until(() => Math.abs(r.race.cars[1].dist - goalOrb) < 1 && Math.abs(r.race.cars[0].dist - goalOrb) < 1);
  A.room.send("o", { id: orb.id });
  await until(() => A.room.state.orbs.has(String(orb.id)));
  B.room.send("o", { id: orb.id });
  check("cápsula: vai para o estado e o 2º recebe deny", A.room.state.orbs.has(String(orb.id)) && (await until(() => B.deny.includes(orb.id))));

  // mensagens demais
  for (let i = 0; i < 200; i++) A.room.send("ping", { c: i });
  await sleep(300);
  const seat = [...r.seats.values()].find((s) => s.car === 0);
  check("mensagens acima do limite são descartadas", seat.drops > 100, `drops ${seat.drops}`);
  await sleep(1200); // o balde volta a encher

  // quem sai no meio
  await bye(B.room);
  check("saiu no meio: não terminou", await until(() => r.race.cars[1].gone));

  // 3 voltas: A vai até a chegada em passos possíveis
  const goal = r.race.track.startS + 3 * L + 5;
  let d = r.race.cars[0].dist;
  while (d < goal) {
    d = Math.min(goal, d + 150);
    pose(A, { ...r.race.cars[0], dist: d, u: 0, v: 60 });
    await sleep(40);
  }
  check("chegada: 3 voltas contadas pela sala", (await until(() => r.race.cars[0].finished !== null, 3000)) && r.race.cars[0].laps.length === 3);
  r.race.endAt = r.race.time; // sem os 12 s de espera dos computadores
  check("fim: resultado no estado", await until(() => A.room.state.phase === "end" && A.room.state.result.length > 2));
  const res = JSON.parse(A.room.state.result);
  check("…6 linhas, o jogador que chegou em 1º", res.rows.length === 6 && res.rows[0].car === 0 && res.rows[0].human, JSON.stringify(res.rows[0]));
  check("…quem saiu está no fim como não terminou", res.rows[5].car === 1 && res.rows[5].gone && res.rows[5].time === null);
  check("…e a sala fecha", await until(() => !roomOf(A.room.roomId), 3000));

  // ── 6 pessoas largam na hora ───────────────────────────────────────────────
  corrida._corridaTiming.lobbyMs = 60000;
  const six = [];
  for (let i = 2; i < 8; i++) six.push(await join(users[i]));
  check(
    "6 pessoas: a mesma largada, sem esperar o minuto",
    six.every((b) => b.room && b.room.roomId === six[0].room.roomId) && (await until(() => six[0].room.state.phase === "countdown", 2000))
  );
  check("…sem computador", (await until(() => six[0].start)) && six[0].start.seats.every((s) => s.human));
  for (const b of six) await bye(b.room);

  // voltar para casa tira da corrida
  const W = await join(users[8]);
  const home = await Service.returnHome(users[8]);
  check("voltar para casa: ok", !home.error, JSON.stringify(home.error || ""));
  check("…e sai da corrida (replaced)", await until(() => W.replaced));
  await bye(W.room);

  console.log(`\n${PASS} ok, ${FAIL} falha(s)`);
  await pool.end().catch(() => {});
  process.exit(FAIL ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
