// test/meu-mundo-jetpack.e2e.js — MEU MUNDO 3D: jetpack no túnel (mm3d-63)
//
// Roda: TEST_DATABASE_URL=postgres://...localhost.../mm npm run test:meu-mundo-jetpack
//
// ⚠️ NÃO APONTA PARA PRODUÇÃO (recusa host que não seja local): cria num banco
// descartável o esqueleto mínimo e usuários SIMULADOS ("mmtest_*"). Os
// clientes são WebSocket reais do @colyseus/sdk.
//
// Prova: só entra no centro e perto da porta; SOZINHO é uma sala só sua que
// larga na hora; em grupo quem chega na espera cai na MESMA largada (e nunca
// na sala de quem voa sozinho); passou o prazo, tranca e larga; "start" traz
// a MESMA semente; as poses chegam a 20 Hz; pose impossível é limitada (z,
// dentro do túnel, galões e pontos com teto); quem bate manda o fim e o voo
// só acaba quando o último bate; quem sai vira "saiu"; resultado pela
// distância; 6 largam na hora; voltar para casa tira do jetpack.

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

async function bootstrap(pool) {
  await pool.query(`DROP TABLE IF EXISTS tb_mm_refine_proposal, tb_mm_gear_unlock, tb_mm_quest, tb_mm_equip, tb_mm_gear, tb_mm_fight, tb_mm_receipt, tb_mm_adventure, tb_mm_artifact, tb_mm_clan,
                    tb_mm_car_paint_owned, tb_mm_consume_key, tb_mm_pantry, tb_mm_skin_owned, tb_mm_character_event,
                    tb_mm_character_day, tb_mm_character, tb_mm_wallet, tb_mm_notice, tb_mm_mail,
                    tb_mm_visit, tb_mm_avatar_pref, tb_mm_residence, tb_mm_house, tb_mm_lot,
                    tb_mm_neighborhood, tb_user_role, tb_role, tb_user CASCADE`);
  await pool.query(`CREATE TABLE tb_user (id_user UUID PRIMARY KEY, username TEXT, email TEXT)`);
  await pool.query(`CREATE TABLE tb_role (id_role SERIAL PRIMARY KEY, desc_role TEXT, is_active BOOLEAN DEFAULT TRUE)`);
  await pool.query(`CREATE TABLE tb_user_role (id_user UUID, id_role INT, is_active BOOLEAN DEFAULT TRUE)`);
  await pool.query(`INSERT INTO tb_role (desc_role) VALUES ('Administrator')`);
  await require("./helpers/mmPolens").polenTables(pool);
  // todas as do Meu Mundo (como a suíte da aventura); chat (303) e salão (312) dependem de tabelas de fora
  const all = fs
    .readdirSync(path.join(__dirname, "../src/databases/migrations"))
    .filter((f) => /^\d{3}_meu_mundo/.test(f) && Number(f.slice(0, 3)) >= 291 && !/^(303|312)_/.test(f))
    .sort();
  for (const f of all) await pool.query(fs.readFileSync(path.join(__dirname, "../src/databases/migrations", f), "utf8"));
}

async function mkUser(pool, tag) {
  const id = crypto.randomUUID();
  await pool.query(`INSERT INTO tb_user VALUES ($1, $2, $3)`, [id, `mmtest_${tag}`, `${id}@mm.test`]);
  await pool.query(`INSERT INTO tb_user_role (id_user, id_role) VALUES ($1, 1)`, [id]);
  // classes (mm3d-58): sem classe o bairro pede a escolha (409 needs_clan)
  await pool.query(`INSERT INTO tb_mm_clan (id_user, clan, sex) VALUES ($1, 'vampiro', 'm')`, [id]);
  return id;
}

(async () => {
  const pool = require("../src/databases");
  await bootstrap(pool);
  const Storage = require("../src/storages/MeuMundoStorage");
  const express = require("express");
  const realtime = require("../src/realtime/meuMundo");
  const jet = require("../src/realtime/meuMundoJetpack");
  const presence = require("../src/realtime/meuMundoPresence");
  const Service = require("../src/services/MeuMundoService");
  const Center = require("../src/utils/meuMundoCenter");
  jet._jetpackTiming.lobbyMs = 1200;
  jet._jetpackTiming.closeMs = 500;

  // 10 administradores: 9 no centro, 1 na rua.
  const users = [];
  for (let i = 0; i < 10; i++) users.push(await mkUser(pool, `j${i}`));
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
  const DOOR = Center.PLACES.find((p) => p.id === "jetpack").interact;
  function nearDoor(u, dx = 0) {
    const here = presence.get(u);
    const room = realtime._centerRooms().find((r) => r.roomId === here.id);
    const s = [...room.sim.values()].find((x) => x.userId === u);
    Object.assign(s.body, { x: DOOR.x + dx, z: DOOR.z });
  }
  async function join(u, solo = false, phase) {
    const out = await Service.joinJetpack(u, { solo, phase });
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
  const roomOf = (id) => jet._jetpackRooms().find((r) => r.roomId === id);
  const seatOf = (r, slot) => [...r.seats.values()].find((s) => s.slot === slot);
  const pose = (box, z, extra = {}) => box.room.send("p", { z, x: 0, y: 4, f: 1, s: Math.floor(z), c: 0, ...extra });

  // ── Quem pode entrar ──────────────────────────────────────────────────────
  const place = Center.PLACES.find((p) => p.id === "jetpack");
  check("o centro tem o Jetpack como minijogo, até 6", place.destination === "game:jetpack" && place.party === 6);
  const far = await Service.joinJetpack(users[0], {});
  check("longe da porta: 409 far", far.statusCode === 409 && far.code === "far", JSON.stringify(far));
  const street = await Service.joinJetpack(users[9], {});
  check("fora do centro: 409", street.statusCode === 409);
  for (let i = 0; i < 9; i++) nearDoor(users[i]);

  // ── Sozinho: sala só sua, larga na hora ───────────────────────────────────
  const S = await join(users[8], true);
  check("sozinho: larga na hora (sem espera)", (await until(() => S.start, 2000)) && S.start.solo === true && S.start.seats.length === 1 && S.start.seed > 0);
  check("…sem fase pedida, voa o túnel original (mm3d-75)", S.start.phase === "industrial", String(S.start.phase));
  const bodyNow = await Storage.getBody(pool, users[8]);
  check(
    "…com o corpo da conta (o da classe), nunca o do aparelho",
    S.start.seats[0].body === bodyNow && Storage.BODIES.includes(bodyNow) && typeof S.start.seats[0].look === "string",
    `${S.start.seats[0].body} × ${bodyNow}`
  );

  const Life = require("../src/services/MeuMundoLifeService");
  const spd = (await Life.peek(users[8])).character.attributes.speed;
  check("…com o fator de velocidade do ATRIBUTO velocidade", S.start.seats[0].k === jet.speedFactor(spd) && S.start.seats[0].k >= 0.85 && S.start.seats[0].k <= 1.35, `${S.start.seats[0].k} (vel ${spd})`);
  check("fator: 0 → 0,85; 1000 → 1,35; 500 → 1,1", jet.speedFactor(0) === 0.85 && jet.speedFactor(1000) === 1.35 && jet.speedFactor(500) === 1.1 && jet.speedFactor(5000) === 1.35);

  // ── Grupo: espera de 1 minuto (encurtada) ─────────────────────────────────
  const A = await join(users[0]);
  check("grupo: o 1º fica esperando, com o prazo", A.room.state.phase === "lobby" && A.welcome.left > 0);
  check("…e não cai na sala de quem voa sozinho", A.room.roomId !== S.room.roomId);
  const B = await join(users[1]);
  check("o 2º cai na mesma largada", B.room.roomId === A.room.roomId);
  check("passou o prazo: larga (contagem)", await until(() => A.room.state.phase === "countdown", 4000));
  check("start: cada um com a sua vaga", (await until(() => A.start && B.start)) && A.start.me === 0 && B.start.me === 1);
  check("…a MESMA semente para os dois, em grupo", A.start.seed === B.start.seed && A.start.seed > 0 && A.start.solo === false);
  check("…2 vagas", A.start.seats.length === 2, JSON.stringify(A.start.seats));
  const Cx = await join(users[2]);
  check("trancada: quem chega depois vai para outra largada", Cx.room && Cx.room.roomId !== A.room.roomId && Cx.room.state.phase === "lobby");
  await bye(Cx.room);

  // ── Fases (mm3d-75): a sala é por fase ────────────────────────────────────
  check("fase desconhecida vira a original; as 6 jogáveis", jet.phaseOf("zzz") === "industrial" && jet.phaseOf("artico") === "artico" && jet.JETPACK_PHASES.length === 6);
  const P1 = await join(users[2], false, "canion");
  const P2 = await join(users[3], false, "canion");
  check("grupo do Cânion: os dois na mesma sala, separada das outras fases", P1.room.roomId === P2.room.roomId && P1.room.roomId !== Cx.room.roomId && roomOf(P1.room.roomId).phase === "canion");
  roomOf(P1.room.roomId).state.until = Date.now();
  check("…a largada leva a fase e a mesma semente", (await until(() => P1.start && P2.start, 4000)) && P1.start.phase === "canion" && P2.start.phase === "canion" && P1.start.seed === P2.start.seed);
  await bye(P1.room);
  await bye(P2.room);

  const r = roomOf(A.room.roomId);
  r.startedAt -= 3000; // pula a contagem
  check("voo começa", await until(() => A.room.state.phase === "run"));
  check("as poses chegam a ~20 Hz", (await until(() => A.snaps >= 10, 2000)) && A.last.c.length === 2 * 7);

  pose(A, 30, { x: 2.5, s: 40 });
  check("pose normal: a sala acompanha", await until(() => Math.abs(seatOf(r, 0).run.z - 30) < 0.01 && seatOf(r, 0).run.x === 2.5));
  await sleep(60);
  pose(A, 9000, { x: 99, y: -5, s: 999999, c: 9999 });
  await until(() => seatOf(r, 0).run.z > 31);
  const s0 = seatOf(r, 0).run;
  check("pose impossível (9 km de uma vez): limitada", s0.z < 120, String(s0.z));
  check("…presa dentro do túnel", s0.x === 5 && s0.y === 0, `${s0.x},${s0.y}`);
  check("…galões e pontos com teto pela distância", s0.cans <= Math.floor(s0.z / 3) && s0.score <= Math.floor(s0.z) + s0.cans * 25);
  const zBefore = s0.z;
  pose(A, 1, {});
  await sleep(100);
  check("…e a distância não volta", seatOf(r, 0).run.z >= zBefore - 2);
  for (let z = 20; z <= 160; z += 20) {
    pose(B, z, { s: z });
    await sleep(60);
  }
  check("o snapshot traz os dois com distância", await until(() => A.last && A.last.c[1] > 0 && A.last.c[8] > 100));

  for (let i = 0; i < 200; i++) A.room.send("ping", { c: i });
  await sleep(300);
  check("mensagens acima do limite são descartadas", seatOf(r, 0).drops > 100, `drops ${seatOf(r, 0).drops}`);
  await sleep(1200);

  A.room.send("x", { z: zBefore + 10, s: 200, c: 4, by: "crusher" });
  check("bateu: fica fora, o voo continua", (await until(() => !seatOf(r, 0).run.alive)) && A.room.state.phase === "run");
  check("…o snapshot mostra batido", await until(() => A.last.c[6] === 0));
  await bye(B.room);
  check("saiu no meio: vira 'saiu' e o voo acaba", await until(() => A.room.state.phase === "end" && A.room.state.result.length > 2));
  const res = JSON.parse(A.room.state.result);
  check(
    "…2 linhas pela distância, quem bateu com o que pegou",
    res.rows.length === 2 && res.rows[0].slot === 1 && res.rows[1].by === "crusher",
    JSON.stringify(res.rows)
  );
  check("…quem saiu está marcado", res.rows[0].gone === true);
  check("…e a sala fecha", await until(() => !roomOf(A.room.roomId), 3000));
  await bye(A.room);

  // sozinho bate: a sala termina sozinha
  const rs = roomOf(S.room.roomId);
  rs.startedAt -= 3000;
  await until(() => S.room.state.phase === "run");
  S.room.send("p", { z: 40, x: 0, y: 4, f: 1, s: 40, c: 1 });
  await sleep(80);
  S.room.send("x", { z: 45, x: 0, y: 1, s: 70, c: 1, by: "pressV" });
  check("sozinho bateu: a sala encerra", await until(() => S.room.state.phase === "end"));
  await bye(S.room);

  // ── 6 pessoas largam na hora ───────────────────────────────────────────────
  jet._jetpackTiming.lobbyMs = 60000;
  const six = [];
  for (let i = 2; i < 8; i++) six.push(await join(users[i]));
  check(
    "6 pessoas: a mesma largada, sem esperar o minuto",
    six.every((b) => b.room && b.room.roomId === six[0].room.roomId) && (await until(() => six[0].room.state.phase === "countdown", 2000))
  );
  check(
    "…as 6 com a mesma semente",
    (await until(() => six.every((b) => b.start))) && six.every((b) => b.start.seed === six[0].start.seed && b.start.seats.length === 6)
  );
  for (const b of six) await bye(b.room);

  // voltar para casa tira do jetpack
  const W = await join(users[8]);
  const home = await Service.returnHome(users[8]);
  check("voltar para casa: ok", !home.error, JSON.stringify(home.error || ""));
  check("…e sai do jetpack (replaced)", await until(() => W.replaced));
  await bye(W.room);

  console.log(`\n${PASS} ok, ${FAIL} falha(s)`);
  await pool.end().catch(() => {});
  process.exit(FAIL ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
