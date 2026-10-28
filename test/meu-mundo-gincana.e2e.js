// test/meu-mundo-gincana.e2e.js — MEU MUNDO 3D: Gincana em grupo (mm3d-47)
//
// Roda: TEST_DATABASE_URL=postgres://...localhost.../mm npm run test:meu-mundo-gincana
//
// ⚠️ NÃO APONTA PARA PRODUÇÃO (recusa host que não seja local): cria num banco
// descartável o esqueleto mínimo e usuários SIMULADOS ("mmtest_*"). Os
// clientes são WebSocket reais do @colyseus/sdk.
//
// Prova: só entra no centro e perto da porta; quem chega na espera cai na
// MESMA largada; passou o prazo, a sala tranca e larga com as pessoas e o
// COMPUTADOR completando as 8 vagas; "start" traz a MESMA semente, o corpo e
// as cores da conta de cada pessoa e os computadores; as poses de todos (os
// computadores andando na sala) chegam a 20 Hz; pose impossível é limitada,
// voltar ao posto (caiu na água) é aceito; chegada sem passar pelos postos é
// recusada; quem percorre a prova chega e, sem mais ninguém correndo, a prova
// acaba com a classificação (8 linhas) e a sala fecha; 8 pessoas largam na
// hora (sem computador); voltar para casa tira da gincana.

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
  const gincana = require("../src/realtime/meuMundoGincana");
  const presence = require("../src/realtime/meuMundoPresence");
  const Service = require("../src/services/MeuMundoService");
  const Center = require("../src/utils/meuMundoCenter");
  const G = require("../src/utils/meuMundoGincana");
  gincana._gincanaTiming.lobbyMs = 1200;
  gincana._gincanaTiming.closeMs = 500;

  // 10 administradores: 9 no centro, 1 na rua.
  const users = [];
  for (let i = 0; i < 10; i++) users.push(await mkUser(pool, `g${i}`));
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
  const PLACE = Center.PLACES.find((p) => p.id === "gincana");
  const DOOR = PLACE.interact;
  function nearDoor(u, dx = 0) {
    const here = presence.get(u);
    const room = realtime._centerRooms().find((r) => r.roomId === here.id);
    const s = [...room.sim.values()].find((x) => x.userId === u);
    Object.assign(s.body, { x: DOOR.x + dx, z: DOOR.z });
  }
  async function join(u, body = "normal") {
    const out = await Service.joinGincana(u, { body });
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
  const roomOf = (id) => gincana._gincanaRooms().find((r) => r.roomId === id);
  const pose = (box, p) => box.room.send("p", { x: 0, y: G.DECK, f: 0, a: 1, cp: 0, n: -1, ...p });

  // ── Quem pode entrar ──────────────────────────────────────────────────────
  check("o centro tem a Gincana como minijogo, para 8", PLACE.destination === "game:gincana" && PLACE.party === 8);
  const far = await Service.joinGincana(users[0], {});
  check("longe da porta: 409 far", far.statusCode === 409 && far.code === "far", JSON.stringify(far));
  const street = await Service.joinGincana(users[9], {});
  check("fora do centro: 409", street.statusCode === 409);
  for (let i = 0; i < 9; i++) nearDoor(users[i]);

  // ── Espera (encurtada); o computador completa as 8 vagas ─────────────────
  const A = await join(users[0], "female");
  check("o 1º fica esperando, com o prazo da espera", A.room.state.phase === "lobby" && A.welcome.left > 0);
  const B = await join(users[1], "dragao");
  check("o 2º cai na mesma largada", B.room.roomId === A.room.roomId);
  check("passou o prazo: larga (contagem)", await until(() => A.room.state.phase === "countdown", 4000));
  check("start: cada um com a sua vaga", (await until(() => A.start && B.start)) && A.start.me === 0 && B.start.me === 1);
  check("…a MESMA semente para os dois", A.start.seed === B.start.seed && A.start.seed > 0);
  check("…8 vagas: 2 pessoas e 6 computadores", A.start.seats.length === 8 && A.start.seats.filter((s) => s.bot).length === 6, JSON.stringify(A.start.seats));
  const sa = A.start.seats.find((s) => s.slot === 0);
  const sb = A.start.seats.find((s) => s.slot === 1);
  check("…corpo de cada um (desconhecido vira normal) e cores", sa.body === "female" && sb.body === "normal" && typeof sa.look === "string" && !sa.bot);
  check("…computador com nome, corpo e cores válidas", A.start.seats.filter((s) => s.bot).every((s) => s.name && /^[0-9a-z]{4}$/.test(s.look)));
  const Cx = await join(users[2]);
  check("trancada: quem chega depois vai para outra largada", Cx.room && Cx.room.roomId !== A.room.roomId && Cx.room.state.phase === "lobby");
  check("sozinho depois do prazo: ele e 7 computadores", (await until(() => Cx.start, 4000)) && Cx.start.seats.length === 8 && Cx.start.seats.filter((s) => !s.bot).length === 1);
  await bye(Cx.room);

  const r = roomOf(A.room.roomId);
  r.startedAt -= 3000; // pula a contagem
  check("prova começa", await until(() => A.room.state.phase === "run"));
  check("as poses de todos chegam a ~20 Hz", (await until(() => A.snaps >= 10, 2000)) && A.last.c.length === 8 * 8);
  const z0 = A.last.c.filter((_, i) => i % 8 === 3);
  await sleep(1500);
  const z1 = A.last.c.filter((_, i) => i % 8 === 3);
  check("os computadores correm na sala", [2, 3, 4, 5, 6, 7].some((slot) => z1[slot] > z0[slot] + 3), JSON.stringify([z0, z1]));

  // pose: normal passa, impossível é limitada, voltar ao posto é aceito
  const me = () => r.race.runner(0);
  pose(A, { x: 1, z: 2 });
  check("pose normal: a sala acompanha", await until(() => Math.abs(me().z - 2) < 0.01 && me().x === 1));
  await sleep(60);
  pose(A, { z: 200 });
  await until(() => me().z > 2.5);
  check("pose impossível (200 m de uma vez): limitada", me().z < 12, String(me().z));
  await sleep(60);
  const back = G.spawnAt(0, 0);
  pose(A, { x: back.x, z: back.z });
  check("voltar ao posto (caiu na água): aceito", await until(() => Math.abs(me().z - back.z) < 0.01));
  pose(A, { x: back.x, z: back.z + 1, cp: 4, n: 30 });
  await sleep(120);
  check("posto pulado e chegada sem passar pela prova: recusados", me().cp === 0 && me().fin < 0, JSON.stringify({ cp: me().cp, fin: me().fin }));

  // mensagens demais
  const seatA = [...r.seats.values()].find((s) => s.slot === 0);
  for (let i = 0; i < 200; i++) A.room.send("ping", { c: i });
  await sleep(300);
  check("mensagens acima do limite são descartadas", seatA.drops > 100, `drops ${seatA.drops}`);
  await sleep(1300); // o balde volta a encher

  // B sai no meio: vira "saiu"
  await bye(B.room);
  check("saiu no meio: marcado", await until(() => [...r.seats.values()].find((s) => s.slot === 1).gone));

  // A percorre a prova (pose a pose, passando pelos postos) e chega
  r.startedAt -= 25000; // o relógio passa do mínimo de uma chegada
  let z = me().z;
  let cp = 0;
  while (z < G.FINISH_Z + 1) {
    z = Math.min(G.FINISH_Z + 1, z + 2.4);
    while (G.CHECKPOINTS[cp + 1] && z >= G.CHECKPOINTS[cp + 1].z) cp++;
    const y = z > G.RAMP.z0 ? G.rampTop(Math.min(z, G.RAMP.z1)) : G.DECK;
    const fin = z >= G.FINISH_Z ? r.state.time : -1;
    pose(A, { x: 0, y, z, cp, n: fin });
    await sleep(40);
  }
  check("passou pelos postos", await until(() => me().cp === G.CHECKPOINTS.length - 1), String(me().cp));
  check("chegou: o tempo é o da sala", await until(() => me().fin > 20), String(me().fin));
  check("sem mais ninguém correndo: a prova acaba", await until(() => A.room.state.phase === "end" && A.room.state.result.length > 2, 3000));
  const res = JSON.parse(A.room.state.result);
  const mine = res.rows.find((x) => x.slot === 0);
  check(
    "…8 linhas, quem chegou com tempo antes dos que não chegaram",
    res.rows.length === 8 && mine.fin > 0 && res.rows.every((x, i) => i === 0 || x.fin < 0 || res.rows[i - 1].fin >= 0),
    JSON.stringify(res.rows)
  );
  check("…quem saiu e os computadores marcados", res.rows.find((x) => x.slot === 1).gone && res.rows.filter((x) => x.bot).length === 6);
  check("…e a sala fecha", await until(() => !roomOf(A.room.roomId), 3000));
  await bye(A.room);

  // ── 8 pessoas largam na hora, sem computador ───────────────────────────────
  gincana._gincanaTiming.lobbyMs = 60000;
  const eight = [];
  for (let i = 0; i < 8; i++) eight.push(await join(users[i]));
  check(
    "8 pessoas: a mesma largada, sem esperar o minuto",
    eight.every((b) => b.room && b.room.roomId === eight[0].room.roomId) && (await until(() => eight[0].room.state.phase === "countdown", 2000))
  );
  check(
    "…as 8 com a mesma semente e nenhum computador",
    (await until(() => eight.every((b) => b.start))) && eight.every((b) => b.start.seed === eight[0].start.seed && b.start.seats.every((s) => !s.bot))
  );
  for (const b of eight) await bye(b.room);

  // voltar para casa tira da gincana
  const W = await join(users[8]);
  const home = await Service.returnHome(users[8]);
  check("voltar para casa: ok", !home.error, JSON.stringify(home.error || ""));
  check("…e sai da gincana (replaced)", await until(() => W.replaced));
  await bye(W.room);

  console.log(`\n${PASS} ok, ${FAIL} falha(s)`);
  await pool.end().catch(() => {});
  process.exit(FAIL ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
