// test/meu-mundo-paint.e2e.js — MEU MUNDO 3D: Paint (mm3d-35)
//
// Roda: TEST_DATABASE_URL=postgres://...localhost.../mm npm run test:meu-mundo-paint
//
// ⚠️ NÃO APONTA PARA PRODUÇÃO (recusa host que não seja local): cria num banco
// descartável o esqueleto mínimo e usuários SIMULADOS ("mmtest_*"). Os
// clientes são WebSocket reais do @colyseus/sdk.
//
// Prova: só entra no centro e perto da porta; modo inválido = 400; treino é
// sala só sua e começa na hora; 1×1 junta dois do mesmo centro em times
// diferentes, começa cheio e tranca (o 3º cai em outra sala); 3×3 = 3 e 3;
// pela rede: tinta turquesa vira mancha no estado com o número do tiro de
// quem atirou; vermelho tira coração do outro time (pacote `ev` para todos,
// com o empurrão) e apaga a tinta dele; soco; pose impossível recebe `fix`
// só para quem mandou; gatinho e cápsula vão para o estado e para o `ev`;
// queda no meio da partida mantém o jogador (fora dos alvos) e a volta pela
// reserva liga à mesma vaga; outra aba substitui (4009); voltar para casa tira
// do Paint; fim → resultado no estado e a sala fecha; mensagens demais são
// descartadas.

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
];
const TABLES = `tb_mm_consume_key, tb_mm_pantry, tb_mm_skin_owned, tb_mm_character_event, tb_mm_character_day, tb_mm_character, tb_mm_wallet, tb_mm_vehicle, tb_mm_visit,
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
  const paint = require("../src/realtime/meuMundoPaint");
  const presence = require("../src/realtime/meuMundoPresence");
  const Service = require("../src/services/MeuMundoService");
  const Center = require("../src/utils/meuMundoCenter");
  const P = require("../src/utils/meuMundoPaint");
  const T = P.TUNING;
  paint._paintTiming.closeMs = 500;

  // 12 administradores: 11 no centro, 1 na rua.
  const users = [];
  for (let i = 0; i < 12; i++) users.push(await mkUser(pool, `p${i}`));
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
  for (const u of users.slice(0, 11)) {
    const out = await Service.travelToCenter(u);
    if (out.error) throw new Error(out.error);
    const room = await consume(out);
    await bye(live.get(u).nb);
    live.set(u, { center: room });
  }
  const DOOR = Center.PLACES.find((p) => p.id === "paint").interact;
  function nearDoor(u, dx = 0) {
    const here = presence.get(u);
    const room = realtime._centerRooms().find((r) => r.roomId === here.id);
    const s = [...room.sim.values()].find((x) => x.userId === u);
    Object.assign(s.body, { x: DOOR.x + dx, z: DOOR.z });
  }
  async function join(u, mode, roomId = null) {
    const out = await Service.joinPaint(u, { mode, roomId });
    if (out.error) return { out };
    const room = await consume(out);
    const box = { out, room, welcome: null, replaced: false, code: null, ev: [] };
    room.onMessage("welcome", (m) => (box.welcome = m));
    room.onMessage("replaced", () => (box.replaced = true));
    room.onMessage("ev", (list) => box.ev.push(...list));
    room.onMessage("pong", () => {});
    room.onLeave((code) => (box.code = code));
    await until(() => box.welcome);
    return box;
  }
  const roomOf = (id) => paint._paintRooms().find((r) => r.roomId === id);
  const playerOf = (box, slot) => [...box.room.state.players.values()].find((p) => p.slot === slot);
  /** Pula a contagem (a regra começa em -5 s). */
  const go = (r) => {
    r.match.time = -0.01;
  };

  // ── Quem pode entrar ──────────────────────────────────────────────────────
  check("o centro tem o Paint como minijogo", Center.PLACES.find((p) => p.id === "paint").destination === "game:paint");
  const far = await Service.joinPaint(users[0], { mode: "solo" });
  check("longe da porta: 409 far", far.statusCode === 409 && far.code === "far", JSON.stringify(far));
  const street = await Service.joinPaint(users[11], { mode: "solo" });
  check("fora do centro: 409", street.statusCode === 409);
  for (let i = 0; i < 11; i++) nearDoor(users[i]);
  const bad = await Service.joinPaint(users[0], { mode: "9v9" });
  check("modo inválido: 400", bad.statusCode === 400);

  // ── Treino ───────────────────────────────────────────────────────────────
  const solo = await join(users[0], "solo");
  const solo2 = await join(users[1], "solo");
  check("treino: sala só sua", solo.room && solo2.room && solo.room.roomId !== solo2.room.roomId);
  check("treino começa na hora (contagem)", await until(() => solo.room.state.phase === "countdown" || solo.room.state.phase === "play"));
  check("welcome traz vaga e modo", solo.welcome.slot === 0 && solo.welcome.mode === "solo");
  await bye(solo.room);
  await bye(solo2.room);

  // ── 1×1 ──────────────────────────────────────────────────────────────────
  const A = await join(users[2], "1v1");
  check("1×1: sozinho fica esperando", A.room.state.phase === "lobby");
  const B = await join(users[3], "1v1");
  check("1×1: o 2º entra na mesma sala", B.room.roomId === A.room.roomId);
  check("1×1: começa cheio", await until(() => A.room.state.phase === "countdown"));
  await until(() => A.room.state.players.size === 2);
  const pa = playerOf(A, A.welcome.slot);
  const pb = playerOf(A, B.welcome.slot);
  check("1×1: times diferentes", pa && pb && pa.team !== pb.team, `${pa && pa.team} ${pb && pb.team}`);
  const C = await join(users[4], "1v1");
  check("1×1 cheio e trancado: o 3º vai para outra sala", C.room && C.room.roomId !== A.room.roomId);
  await bye(C.room);

  const r1 = roomOf(A.room.roomId);
  go(r1);
  check("pela rede: partida começa", await until(() => A.room.state.phase === "play"));
  const m = r1.match;
  const sa = A.welcome.slot;
  const sb = B.welcome.slot;
  const ta = m.players.get(sa).team;
  const base = m.map.islands[m.map.bases[ta].island];
  const place = (slot, x, y, z, facing = 0) => {
    const p = m.players.get(slot);
    p.pose = { x, y, z, facing, ground: true, gy: y, e: p.epoch };
  };

  // tinta turquesa vira mancha no estado, com o número do tiro
  place(sa, base.x, 0, base.z + base.r - 0.7, 0);
  await sleep(120);
  const muzzle = P.muzzleOf(m.players.get(sa).pose, 0);
  A.room.send("f", { c: 0, o: [muzzle.x, muzzle.y, muzzle.z], d: [0, 0, 1], q: 77 });
  check("ponte: mancha no estado para os dois", await until(() => A.room.state.blobs.size === 1 && B.room.state.blobs.size === 1));
  const [blobId, blob] = [...B.room.state.blobs.entries()][0];
  check("…com dono e número do tiro de quem atirou", blob.owner === sa && blob.q === 77 && blob.c === 0);
  check("…munição turquesa desceu no estado", await until(() => playerOf(A, sa).a0 === T.ammoStart - 1));

  // vermelho no outro time
  place(sb, base.x, 0, base.z + 6, Math.PI);
  place(sa, base.x, 0, base.z, 0);
  await sleep(120);
  A.ev.length = 0;
  B.ev.length = 0;
  const o2 = P.muzzleOf(m.players.get(sa).pose, 0);
  A.room.send("f", { c: 1, o: [o2.x, o2.y, o2.z], d: [base.x - o2.x, 1.0 - o2.y, base.z + 6 - o2.z], q: 78 });
  check("vermelho: o outro time perde coração (ev para os dois)", await until(() => A.ev.some((e) => e.type === "hit" && e.slot === sb) && B.ev.some((e) => e.type === "hit" && e.slot === sb && e.kz > 0)));
  check("…e no estado", await until(() => playerOf(B, sb).hp === T.hearts - 1));
  check("quem atirou não recebe o próprio rastro", !A.ev.some((e) => e.type === "shot" && e.slot === sa) && B.ev.some((e) => e.type === "shot" && e.slot === sa));

  // vermelho do outro time apaga a tinta
  place(sb, base.x - 1.2, 0, base.z + base.r - 2.4, 0);
  place(sa, base.x + 4, 0, base.z - 4);
  await sleep(320);
  const ob = P.muzzleOf(m.players.get(sb).pose, 0);
  B.room.send("f", { c: 1, o: [ob.x, ob.y, ob.z], d: [blob.x - ob.x, blob.y1 - 0.1 - ob.y, blob.z - ob.z], q: 5 });
  check("vermelho apaga a tinta do outro time", await until(() => A.room.state.blobs.size === 0 && !B.room.state.blobs.has(blobId)));

  // soco
  place(sa, base.x, 0, base.z, 0);
  place(sb, base.x, 0, base.z + 1.2, Math.PI);
  await sleep(100);
  B.ev.length = 0;
  A.room.send("u", {});
  check("soco: hit com empurrão forte", await until(() => B.ev.some((e) => e.type === "hit" && e.how === "punch" && e.kz > 5)));

  // pose impossível → fix só para quem mandou
  A.ev.length = 0;
  B.ev.length = 0;
  const cur = m.players.get(sa).pose;
  A.room.send("p", { x: cur.x + 60, y: cur.y, z: cur.z, f: 0, g: true, gy: cur.gy, e: m.players.get(sa).epoch });
  check("pose impossível: fix para quem mandou", await until(() => A.ev.some((e) => e.type === "fix")));
  check("…e não para o outro", !B.ev.some((e) => e.type === "fix"));

  // gatinho e cápsula
  const cat = m.map.cats.find((c) => Math.hypot(c.x - base.x, c.z - base.z) < base.r && Math.abs(c.y) < 1e-6);
  place(sa, cat.x, cat.y, cat.z);
  check("gatinho: ev com quem pegou e estado do time", await until(() => B.ev.some((e) => e.type === "cat" && e.id === cat.id && e.slot === sa) && A.room.state.cats.get(String(cat.id)) === ta));
  check("…gatinhos do time no estado", (ta === 0 ? A.room.state.tc0 : A.room.state.tc1) === 1);
  m.players.get(sa).ammo[2] = 0;
  const cap = m.map.capsules.find((c) => c.c === 2 && Math.hypot(c.x - base.x, c.z - base.z) < base.r && Math.abs(c.y) < 1e-6);
  place(sa, cap.x, cap.y, cap.z);
  check("cápsula: some no estado e recarrega", await until(() => A.room.state.caps.has(String(cap.id)) && playerOf(A, sa).a2 === T.capsuleGive));

  // queda no meio da partida e volta pela reserva
  await bye(B.room, false);
  check("caiu no meio: continua na partida, offline", await until(() => playerOf(A, sb) && playerOf(A, sb).online === false));
  check("…fora dos alvos", m.players.get(sb).online === false);
  const B2 = await join(users[3], "1v1", A.room.roomId);
  check("volta pela reserva: mesma sala e mesma vaga", B2.room && B2.room.roomId === A.room.roomId && B2.welcome.slot === sb);
  check("…online de novo", await until(() => playerOf(A, sb).online === true));
  // outra aba
  const B3 = await join(users[3], "1v1", A.room.roomId);
  check("outra aba: a anterior sai com 4009", await until(() => B2.code === 4009) && B2.replaced && B3.welcome.slot === sb);

  // mensagens demais
  let sent = 0;
  for (let i = 0; i < 200; i++) {
    A.room.send("u", {});
    sent++;
  }
  await sleep(300);
  const seat = [...r1.seats.values()].find((s) => s.slot === sa);
  check("mensagens acima do limite são descartadas", seat.drops > 100, `drops ${seat.drops} de ${sent}`);

  // fim
  m.finish("time");
  check("fim: resultado no estado", await until(() => A.room.state.phase === "end" && A.room.state.result.length > 2));
  const res = JSON.parse(A.room.state.result);
  check("…com as duas linhas", res.rows.length === 2);
  check("…e a sala fecha", await until(() => !roomOf(A.room.roomId), 3000));

  // ── 3×3 ──────────────────────────────────────────────────────────────────
  const six = [];
  for (let i = 4; i < 10; i++) six.push(await join(users[i], "3v3"));
  check("3×3: os seis na mesma sala", six.every((b) => b.room && b.room.roomId === six[0].room.roomId));
  await until(() => six[0].room.state.players.size === 6 && six[0].room.state.phase === "countdown");
  const teams = [0, 0];
  for (const p of six[0].room.state.players.values()) teams[p.team]++;
  check("3×3: 3 e 3, começa cheio", teams[0] === 3 && teams[1] === 3 && six[0].room.state.phase === "countdown", JSON.stringify(teams));
  const sits = [...six[0].room.state.players.values()].map((p) => `${p.team}:${p.sit}`).sort();
  check("3×3: lugares na base distintos por time", new Set(sits).size === 6);

  // voltar para casa tira do Paint
  const home = await Service.returnHome(users[4]);
  check("voltar para casa: ok", !home.error, JSON.stringify(home.error || ""));
  check("…e sai do Paint (replaced)", await until(() => six[0].replaced));
  for (const b of six) await bye(b.room);

  console.log(`\n${PASS} ok, ${FAIL} falha(s)`);
  await pool.end().catch(() => {});
  process.exit(FAIL ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
