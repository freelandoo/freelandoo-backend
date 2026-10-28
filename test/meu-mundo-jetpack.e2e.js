// test/meu-mundo-jetpack.e2e.js — MEU MUNDO 3D: jetpack em grupo (mm3d-21)
//
// Roda: TEST_DATABASE_URL=postgres://...localhost.../mm npm run test:meu-mundo-jetpack
//
// ⚠️ NÃO APONTA PARA PRODUÇÃO (recusa host que não seja local): cria num banco
// descartável o esqueleto mínimo e usuários SIMULADOS ("mmtest_*"). Os
// clientes são WebSocket reais do @colyseus/sdk.
//
// Prova (sala, S4): 4 do mesmo centro na mesma sala e o 5º em outra; centros
// diferentes não se misturam; fora do centro ou longe da porta = 409; quem não
// é admin é barrado na sala; outra aba substitui sem duplicar (4009); sozinho
// na espera nunca começa; todos prontos → contagem com a sala trancada (quem
// pede agora cai em outra); a presença continua no centro; voltar para casa
// tira da sala. (Corrida, S5): o servidor = a mesma sim rodada aqui com as
// mesmas entradas; queda no meio solta o jogador e a sala segue; volta pela
// reserva liga ao mesmo jogador; resultados → espera e destrava; "jogar de
// novo" nos resultados vale para a espera seguinte; mensagens acima de 30/s
// são descartadas.

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
  const jp = require("../src/realtime/meuMundoJetpack");
  const presence = require("../src/realtime/meuMundoPresence");
  const Service = require("../src/services/MeuMundoService");
  const Center = require("../src/utils/meuMundoCenter");
  const { Match, TUNING, PARTY } = require("../src/utils/meuMundoJetpack");
  const T = jp._jetpackTiming;
  T.lobbyMs = 60000; // o prazo do grupo é provado no fim, com prazo curto
  T.countdownMs = 300;
  T.resultsMs = 900;

  // 23 administradores: 20 num centro, 2 em outro (o 21º abre sala nova), 1 só na rua.
  const users = [];
  for (let i = 0; i < 23; i++) users.push(await mkUser(pool, `j${i}`));
  for (const u of users) await Storage.ensureResidence(pool, u);

  const server = http.createServer(express());
  await new Promise((r) => server.listen(0, r));
  realtime.init(server);
  const port = server.address().port;
  const { Client } = await import("@colyseus/sdk");
  const client = new Client(`ws://127.0.0.1:${port}/mm-ws`);
  const consume = (out) => client.consumeSeatReservation(out.multiplayer.reservation);

  const live = new Map(); // userId → { nb?, center? }
  async function toStreet(u) {
    const room = await consume(await Service.enter(u));
    live.set(u, { nb: room });
  }
  async function toCenter(u) {
    const out = await Service.travelToCenter(u);
    if (out.error) throw new Error(out.error);
    const room = await consume(out);
    await bye(live.get(u).nb);
    live.set(u, { center: room });
  }
  const DOOR = Center.PLACES.find((p) => p.id === "jetpack").interact;
  function nearDoor(u, dx = 0) {
    const here = presence.get(u);
    const room = realtime._centerRooms().find((r) => r.roomId === here.id);
    const s = [...room.sim.values()].find((x) => x.userId === u);
    Object.assign(s.body, { x: DOOR.x + dx, z: DOOR.z });
  }
  /** Entra na sala do jetpack como o cliente faz; guarda mensagens e o código de saída. */
  async function join(u, roomId = null) {
    const out = await Service.joinJetpack(u, { roomId });
    if (out.error) return { out };
    const room = await consume(out);
    const box = { out, room, welcome: null, replaced: false, pongs: 0, code: null };
    room.onMessage("welcome", (m) => (box.welcome = m));
    room.onMessage("replaced", () => (box.replaced = true));
    room.onMessage("pong", () => box.pongs++);
    room.onLeave((code) => (box.code = code));
    await until(() => box.welcome);
    return box;
  }
  const jpRoom = (id) => jp._jetpackRooms().find((r) => r.roomId === id);
  const usersIn = (r) => [...r.sim.values()].map((s) => s.userId);

  for (const u of users) await toStreet(u);
  for (const u of users.slice(0, 22)) await toCenter(u);
  const centerA = presence.get(users[0]).id;
  const centerB = presence.get(users[20]).id;
  check("dois centros abertos (20 + 2)", centerA !== centerB && presence.get(users[21]).id === centerB);

  // ── Quem pode entrar ──────────────────────────────────────────────────────
  const far = await Service.joinJetpack(users[0]);
  check("longe da porta do jetpack: 409", far.statusCode === 409 && far.code === "far", JSON.stringify(far));
  const street = await Service.joinJetpack(users[22]);
  check("fora do centro: 409", street.statusCode === 409);
  nearDoor(users[0], 5.5);
  const edge = await join(users[0]);
  check("a 5,5 m da área da porta entra", !!edge.room);
  await bye(edge.room);
  await until(() => jp._jetpackRooms().length === 0, 2000);
  check("sala vazia fecha", jp._jetpackRooms().length === 0);

  // ── 4 numa sala, o 5º em outra, centros não se misturam ───────────────────
  for (let i = 0; i < 6; i++) nearDoor(users[i]);
  nearDoor(users[20]);
  nearDoor(users[21]);
  const J = [];
  for (let i = 0; i < 4; i++) J.push(await join(users[i]));
  const room1 = J[0].room.roomId;
  check("4 do mesmo centro na mesma sala", J.every((j) => j.room && j.room.roomId === room1), J.map((j) => j.room && j.room.roomId).join(","));
  check("vagas 0..3 distintas", new Set(J.map((j) => j.welcome && j.welcome.slot)).size === 4);
  check("welcome traz o passo da sim", J[0].welcome.step === TUNING.step);
  const J4 = await join(users[4]);
  check("o 5º vai para outra sala", J4.room && J4.room.roomId !== room1);
  const JB = await join(users[20]);
  check("centro diferente: sala própria", JB.room && JB.room.roomId !== room1 && JB.room.roomId !== J4.room.roomId);
  check("a pessoa continua no centro (o jetpack não toma a presença)", presence.get(users[0]).scene === "center" && presence.get(users[0]).id === centerA);
  await until(() => J[0].room.state.runners.size === 4);
  check("cada um vê os 4 na espera", J[0].room.state.runners.size === 4 && J[0].room.state.phase === "lobby");

  // ── Não admin é barrado na sala ───────────────────────────────────────────
  await pool.query(`UPDATE tb_user_role SET is_active = FALSE WHERE id_user = $1`, [users[21]]);
  const plainOut = await Service.joinJetpack(users[21]);
  let denied = false;
  if (!plainOut.error) await consume(plainOut).catch(() => (denied = true));
  check("quem não é admin não entra na sala do jetpack", denied);
  await pool.query(`UPDATE tb_user_role SET is_active = TRUE WHERE id_user = $1`, [users[21]]);

  // ── Outra aba substitui sem duplicar ──────────────────────────────────────
  const again = await join(users[1], room1);
  await until(() => J[1].code !== null);
  check("outra aba: a anterior recebe 'replaced' e sai com 4009", J[1].replaced && J[1].code === 4009, `${J[1].replaced} ${J[1].code}`);
  check("…volta na mesma sala e na mesma vaga", again.room.roomId === room1 && again.welcome.slot === J[1].welcome.slot);
  check("…sem duplicar o jogador", usersIn(jpRoom(room1)).filter((u) => u === users[1]).length === 1 && jpRoom(room1).state.runners.size === 4);
  J[1] = again;

  // ── Sozinho na espera nunca começa ────────────────────────────────────────
  J4.room.send("ready", { r: true });
  await sleep(800);
  check("sozinho e pronto: continua na espera", jpRoom(J4.room.roomId).state.phase === "lobby");

  // ── Todos prontos → contagem, sala trancada ───────────────────────────────
  for (const j of J) j.room.send("ready", { r: true });
  await until(() => jpRoom(room1).state.phase === "countdown", 2000);
  const r1 = jpRoom(room1);
  check("todos prontos: contagem", r1.state.phase === "countdown");
  check("…com a sala trancada", r1.locked === true);
  const late = await join(users[5]);
  check("quem pede durante a contagem cai em outra sala", late.room && late.room.roomId !== room1);
  await bye(late.room);

  // ── Corrida: o servidor = a sim rodada aqui com as mesmas entradas ────────
  const seed = r1.state.seed;
  const slotOf = new Map(J.map((j) => [j.room.sessionId, j.welcome.slot]));
  await until(() => r1.state.phase === "running", 2000);
  check("contagem → corrida", r1.state.phase === "running");
  const sent = []; // { slot, k, h }
  const script = [
    [1, 1, 1, 0],
    [0, 1, 1, 1],
    [1, 0, 1, 0],
    [1, 1, 0, 1],
    [0, 0, 0, 0],
  ];
  for (const row of script) {
    const k = r1.match.ticks + 30; // adiantada: vale exatamente neste passo
    J.forEach((j, i) => {
      j.room.send("h", { k, h: row[i] });
      sent.push({ slot: j.welcome.slot, k, h: !!row[i] });
    });
    await sleep(140);
  }
  await until(() => r1.state.phase === "results", 15000);
  check("todos morreram: resultados", r1.state.phase === "results");
  const replay = new Match(seed, [...slotOf.values()], TUNING);
  replay.start();
  const queue = sent.slice().sort((a, b) => a.k - b.k);
  const held = [false, false, false, false];
  while (replay.aliveCount()) {
    const k = replay.ticks + 1;
    while (queue.length && queue[0].k <= k) {
      const e = queue.shift();
      held[e.slot] = e.h;
    }
    replay.step(held);
  }
  const srv = [...r1.state.runners.values()].sort((a, b) => a.slot - b.slot);
  const mismatch = srv.filter((r) => {
    const m = replay.runners[r.slot];
    return r.dieAt !== m.deathTick || r.x !== m.x || r.y !== m.y || r.fuel !== m.fuel.value;
  });
  check("servidor = sim local (passo da morte, x, y, combustível)", mismatch.length === 0, JSON.stringify(mismatch.map((r) => [r.slot, r.dieAt, replay.runners[r.slot].deathTick])));
  const places = new Map(replay.placements().map((p) => [p.slot, p.place]));
  check("colocações = as da sim", srv.every((r) => r.place === places.get(r.slot)), JSON.stringify(srv.map((r) => [r.slot, r.place])));
  await until(() => J[0].room.state.phase === "results");
  check("o cliente recebe os resultados com a colocação", [...J[0].room.state.runners.values()].every((r) => r.place >= 1));

  // ── "Jogar de novo" nos resultados vale para a espera seguinte ────────────
  check("nos resultados ninguém fica pronto da partida anterior", srv.every((r) => !r.ready));
  for (const j of J) j.room.send("ready", { r: true });
  await until(() => r1.state.phase !== "results", 3000);
  check("todos apertaram 'jogar de novo': a revanche começa", r1.state.phase === "countdown", r1.state.phase);
  await until(() => r1.state.phase === "running", 2000);

  // ── Queda no meio: solta, a sala segue; volta pela reserva ────────────────
  const dropSlot = J[2].welcome.slot;
  await bye(J[2].room, false);
  await until(() => [...r1.state.runners.values()].some((r) => r.slot === dropSlot && !r.online), 2000);
  const dropped = [...r1.state.runners.values()].find((r) => r.slot === dropSlot);
  check("caiu na corrida: o jogador fica, offline e solto", dropped && !dropped.online && !dropped.held);
  check("…a sala segue com os outros", r1.state.phase === "running" || r1.state.phase === "results");
  const ret = await join(users[2], room1);
  check("volta pela reserva: mesma sala e mesma vaga", ret.room && ret.room.roomId === room1 && ret.welcome.slot === dropSlot);
  check("…o mesmo jogador, online de novo", [...r1.state.runners.values()].filter((r) => r.slot === dropSlot).length === 1 && [...r1.state.runners.values()].find((r) => r.slot === dropSlot).online);
  J[2] = ret;

  // ── Resultados → espera, destrava ─────────────────────────────────────────
  await until(() => r1.state.phase === "lobby", 15000);
  check("resultados → de volta à espera", r1.state.phase === "lobby");
  check("…cheia, continua trancada", r1.locked === true);
  check("…ninguém pronto sem apertar de novo", [...r1.state.runners.values()].every((r) => !r.ready));

  // ── Mensagens demais são descartadas ──────────────────────────────────────
  J[0].pongs = 0;
  for (let i = 0; i < 100; i++) J[0].room.send("ping", { c: i });
  await sleep(500);
  check("mais de 30 mensagens/s: o excesso é descartado", J[0].pongs > 0 && J[0].pongs <= 35, String(J[0].pongs));

  // ── Voltar para casa tira do jetpack ──────────────────────────────────────
  await Service.returnHome(users[3]);
  await until(() => !usersIn(r1).includes(users[3]), 2000);
  check("voltar para casa tira da sala do jetpack", !usersIn(r1).includes(users[3]));
  check("…e a vaga abre para outro", r1.state.runners.size === 3);
  await until(() => r1.locked === false, 2000);
  check("…e a sala destrava (espera com vaga)", r1.locked === false);

  // ── Prazo do grupo: com ≥ 2 prontos, larga sem esperar quem não apertou ───
  T.lobbyMs = 400;
  const room2 = J4.room.roomId;
  for (const u of users.slice(6, 9)) nearDoor(u);
  const J6 = await join(users[6]); // completa a sala 1 (a mais cheia com vaga)
  const J7 = await join(users[7]);
  const J8 = await join(users[8]);
  check("a mais cheia com vaga primeiro; depois a do 5º", J6.room.roomId === room1 && J7.room.roomId === room2 && J8.room.roomId === room2);
  J7.room.send("ready", { r: true }); // o 5º já estava pronto; o J8 não aperta
  await until(() => jpRoom(room2).state.phase === "countdown", 2000);
  const r2 = jpRoom(room2);
  check("prazo vencido com 2 prontos: a partida começa", r2.state.phase === "countdown");
  const notIn = [...r2.state.runners.values()].filter((r) => !r.inMatch);
  check("…quem não apertou fica de fora, na espera", notIn.length === 1 && r2.match.slots.length === 2);

  const st = await realtime.status();
  check("status mostra as salas do jetpack", typeof st.jetpackRooms === "number" && st.jetpackRooms >= 1, JSON.stringify(st));
  check("PARTY.max = 4", PARTY.max === 4);

  console.log(`\n${PASS} ok, ${FAIL} falhas`);
  process.exit(FAIL ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
