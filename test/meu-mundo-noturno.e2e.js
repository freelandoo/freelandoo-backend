// test/meu-mundo-noturno.e2e.js — MEU MUNDO 3D: Rolê Noturno em grupo (mm3d-42)
//
// Roda: TEST_DATABASE_URL=postgres://...localhost.../mm npm run test:meu-mundo-noturno
//
// ⚠️ NÃO APONTA PARA PRODUÇÃO (recusa host que não seja local): cria num banco
// descartável o esqueleto mínimo e usuários SIMULADOS ("mmtest_*"). Os
// clientes são WebSocket reais do @colyseus/sdk.
//
// Prova: só entra no centro e perto da porta; quem chega na espera cai na
// MESMA largada; passou o prazo, a sala tranca e larga só com as pessoas (sem
// computador), quem chega depois vai para outra; "start" traz a MESMA semente
// e a rua do grupo para todos, o veículo/corpo de cada um e as cores da conta;
// as poses chegam a 20 Hz; pose impossível é limitada e pontos têm teto;
// quem cai manda o fim e o rolê só acaba quando o último cai; quem sai vira
// "saiu"; resultado pelos pontos no estado e a sala fecha; 6 pessoas largam
// na hora; voltar para casa tira do rolê.

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
  const noturno = require("../src/realtime/meuMundoNoturno");
  const presence = require("../src/realtime/meuMundoPresence");
  const Service = require("../src/services/MeuMundoService");
  const Center = require("../src/utils/meuMundoCenter");
  noturno._noturnoTiming.lobbyMs = 1200;
  noturno._noturnoTiming.closeMs = 500;

  // 10 administradores: 9 no centro, 1 na rua.
  const users = [];
  for (let i = 0; i < 10; i++) users.push(await mkUser(pool, `n${i}`));
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
  const DOOR = Center.PLACES.find((p) => p.id === "noturno").interact;
  function nearDoor(u, dx = 0) {
    const here = presence.get(u);
    const room = realtime._centerRooms().find((r) => r.roomId === here.id);
    const s = [...room.sim.values()].find((x) => x.userId === u);
    Object.assign(s.body, { x: DOOR.x + dx, z: DOOR.z });
  }
  async function join(u, ride = "skate", body = "normal") {
    const out = await Service.joinNoturno(u, { ride, body });
    if (out.error) return { out };
    const room = await consume(out);
    const box = { out, room, welcome: null, start: null, snaps: 0, last: null, replaced: false, code: null };
    room.onMessage("welcome", (m) => (box.welcome = m));
    room.onMessage("start", (m) => (box.start = m));
    room.onMessage("s", (m) => {
      box.snaps++;
      box.last = m;
    });
    room.onMessage("replaced", () => (box.replaced = true));
    room.onMessage("pong", () => {});
    room.onLeave((code) => (box.code = code));
    await until(() => box.welcome);
    return box;
  }
  const roomOf = (id) => noturno._noturnoRooms().find((r) => r.roomId === id);
  const seatOf = (r, slot) => [...r.seats.values()].find((s) => s.slot === slot);
  const pose = (box, z, extra = {}) => box.room.send("p", { z, x: 0, y: 0, f: 0, k: 0, s: Math.floor(z), c: 0, ...extra });

  // ── Quem pode entrar ──────────────────────────────────────────────────────
  check("o centro tem o Rolê Noturno como minijogo", Center.PLACES.find((p) => p.id === "noturno").destination === "game:noturno");
  const far = await Service.joinNoturno(users[0], { ride: "bike" });
  check("longe da porta: 409 far", far.statusCode === 409 && far.code === "far", JSON.stringify(far));
  const street = await Service.joinNoturno(users[9], { ride: "bike" });
  check("fora do centro: 409", street.statusCode === 409);
  for (let i = 0; i < 9; i++) nearDoor(users[i]);

  // ── Espera de 1 minuto (encurtada), sem computador ───────────────────────
  const A = await join(users[0], "bike", "female");
  check("o 1º fica esperando, com o prazo da espera", A.room.state.phase === "lobby" && A.welcome.left > 0);
  const B = await join(users[1], "foguete", "dragao");
  check("o 2º cai na mesma largada", B.room.roomId === A.room.roomId);
  check("passou o prazo: larga (contagem)", await until(() => A.room.state.phase === "countdown", 4000));
  check("start: cada um com a sua vaga", (await until(() => A.start && B.start)) && A.start.me === 0 && B.start.me === 1);
  check(
    "…a MESMA semente e a rua do grupo (bike) para os dois",
    A.start.seed === B.start.seed && A.start.seed > 0 && A.start.street === "bike" && B.start.street === "bike"
  );
  check("…só as pessoas (2 vagas, sem computador)", A.start.seats.length === 2, JSON.stringify(A.start.seats));
  const sa = A.start.seats.find((s) => s.slot === 0);
  const sb = A.start.seats.find((s) => s.slot === 1);
  check("…veículo e corpo de cada um", sa.ride === "bike" && sa.body === "female" && typeof sa.look === "string");
  check("…veículo/corpo desconhecidos viram skate/normal", sb.ride === "skate" && sb.body === "normal");
  const Cx = await join(users[2], "skates");
  check("trancada: quem chega depois vai para outra largada", Cx.room && Cx.room.roomId !== A.room.roomId && Cx.room.state.phase === "lobby");
  check("sozinho depois do prazo: larga só ele", (await until(() => Cx.start, 4000)) && Cx.start.seats.length === 1);
  await bye(Cx.room);

  const r = roomOf(A.room.roomId);
  r.startedAt -= 3000; // pula a contagem
  check("rolê começa", await until(() => A.room.state.phase === "run"));
  check("as poses chegam a ~20 Hz", (await until(() => A.snaps >= 10, 2000)) && A.last.c.length === 2 * 8);

  // pose: normal passa, impossível é limitada, pontos com teto
  pose(A, 30, { x: 2.5, s: 40 });
  check("pose normal: a sala acompanha", await until(() => Math.abs(seatOf(r, 0).run.z - 30) < 0.01 && seatOf(r, 0).run.x === 2.5));
  await sleep(60);
  pose(A, 9000, { s: 999999 });
  await until(() => seatOf(r, 0).run.z > 31);
  check("pose impossível (9 km de uma vez): limitada", seatOf(r, 0).run.z < 200, String(seatOf(r, 0).run.z));
  check("…pontos com teto pela distância", seatOf(r, 0).run.score <= Math.floor(seatOf(r, 0).run.z) * 12 + 500);
  const zBefore = seatOf(r, 0).run.z;
  pose(A, 1, {});
  await sleep(100);
  check("…e a distância não volta", seatOf(r, 0).run.z >= zBefore - 2);
  // B corre um pouco também
  for (let z = 20; z <= 120; z += 20) {
    pose(B, z, { s: z + 50 });
    await sleep(60);
  }
  check("o snapshot traz os dois com distância", await until(() => A.last && A.last.c[1] > 0 && A.last.c[9] > 100));

  // mensagens demais
  for (let i = 0; i < 200; i++) A.room.send("ping", { c: i });
  await sleep(300);
  check("mensagens acima do limite são descartadas", seatOf(r, 0).drops > 100, `drops ${seatOf(r, 0).drops}`);
  await sleep(1200); // o balde volta a encher

  // A cai: o rolê continua com B
  A.room.send("x", { z: zBefore + 10, s: 500, c: 12, t: 2, by: "truck" });
  check("caiu: fica fora, o rolê continua", (await until(() => !seatOf(r, 0).run.alive)) && A.room.state.phase === "run");
  check("…o snapshot mostra caído", await until(() => A.last.c[7] === 0));
  // B sai no meio: ninguém mais correndo = fim
  await bye(B.room);
  check("saiu no meio: vira 'saiu' e o rolê acaba", await until(() => A.room.state.phase === "end" && A.room.state.result.length > 2));
  const res = JSON.parse(A.room.state.result);
  check(
    "…2 linhas pelos pontos, quem caiu com o que derrubou",
    res.rows.length === 2 && res.rows[0].slot === 0 && res.rows[0].by === "truck" && res.rows[0].tricks === 2,
    JSON.stringify(res.rows)
  );
  check("…quem saiu está marcado", res.rows[1].slot === 1 && res.rows[1].gone);
  check("…e a sala fecha", await until(() => !roomOf(A.room.roomId), 3000));
  await bye(A.room);

  // ── 6 pessoas largam na hora ───────────────────────────────────────────────
  noturno._noturnoTiming.lobbyMs = 60000;
  const six = [];
  for (let i = 2; i < 8; i++) six.push(await join(users[i], ["bike", "skate", "skates"][i % 3]));
  check(
    "6 pessoas: a mesma largada, sem esperar o minuto",
    six.every((b) => b.room && b.room.roomId === six[0].room.roomId) && (await until(() => six[0].room.state.phase === "countdown", 2000))
  );
  check(
    "…as 6 com a mesma semente",
    (await until(() => six.every((b) => b.start))) && six.every((b) => b.start.seed === six[0].start.seed && b.start.seats.length === 6)
  );
  for (const b of six) await bye(b.room);

  // voltar para casa tira do rolê
  const W = await join(users[8]);
  const home = await Service.returnHome(users[8]);
  check("voltar para casa: ok", !home.error, JSON.stringify(home.error || ""));
  check("…e sai do rolê (replaced)", await until(() => W.replaced));
  await bye(W.room);

  console.log(`\n${PASS} ok, ${FAIL} falha(s)`);
  await pool.end().catch(() => {});
  process.exit(FAIL ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
