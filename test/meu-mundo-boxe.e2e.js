// test/meu-mundo-boxe.e2e.js — MEU MUNDO 3D: Arena de Boxe (mm3d-43 → mm3d-44, luta ao vivo)
//
// Roda: TEST_DATABASE_URL=postgres://...localhost.../mm npm run test:meu-mundo-boxe
//
// ⚠️ NÃO APONTA PARA PRODUÇÃO (recusa host que não seja local): cria num banco
// descartável o esqueleto mínimo e usuários SIMULADOS ("mmtest_*"). Os
// clientes são WebSocket reais do @colyseus/sdk; o relógio da luta é
// acelerado (timing.speed) para a suíte não esperar 3 minutos.
//
// Prova: a ficha só abre perto da porta e traz os números da vida e os 3 do
// computador; sozinho larga na hora contra o escolhido (o MESMO da ficha); a
// tabela dos golpes e o estado chegam; o joystick anda e o ATAQUE solta golpes
// (mm3d-44); no fim a vida recebe a consequência (energia,
// saúde, cartel; bolsa na vitória) — mesmo com a aba fechada no meio; cansado
// demais não entra; multiplayer junta duas pessoas do mesmo centro na mesma
// luta (cantos 0 e 1, o mesmo estado); toalha encerra e quem jogou perde;
// multiplayer sem ninguém vira computador parelho; voltar para casa tira da espera.

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
const TABLES = `tb_mm_notice, tb_mm_mail, tb_mm_car_paint_owned, tb_mm_consume_key, tb_mm_pantry, tb_mm_skin_owned, tb_mm_character_event, tb_mm_character_day, tb_mm_character, tb_mm_wallet, tb_mm_vehicle, tb_mm_visit,
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
  const boxe = require("../src/realtime/meuMundoBoxe");
  const presence = require("../src/realtime/meuMundoPresence");
  const Service = require("../src/services/MeuMundoService");
  const LifeService = require("../src/services/MeuMundoLifeService");
  // os usuários de teste são admins: aqui se testa a regra normal (cansaço barra a luta)
  LifeService.adminPerks = false;
  const Center = require("../src/utils/meuMundoCenter");
  boxe._boxeTiming.lobbyMs = 1200;
  boxe._boxeTiming.closeMs = 600;
  boxe._boxeTiming.soloDelayMs = 100;
  boxe._boxeTiming.introS = 1;
  boxe._boxeTiming.speed = 120;

  // 8 administradores: 7 no centro, 1 na rua.
  const users = [];
  for (let i = 0; i < 8; i++) users.push(await mkUser(pool, `b${i}`));
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
  for (const u of users.slice(0, 7)) {
    const out = await Service.travelToCenter(u);
    if (out.error) throw new Error(out.error);
    const room = await consume(out);
    await bye(live.get(u).nb);
    live.set(u, { center: room });
  }
  const DOOR = Center.PLACES.find((p) => p.id === "boxe").interact;
  function nearDoor(u) {
    const here = presence.get(u);
    const room = realtime._centerRooms().find((r) => r.roomId === here.id);
    const s = [...room.sim.values()].find((x) => x.userId === u);
    Object.assign(s.body, { x: DOOR.x, z: DOOR.z });
  }
  async function join(u, opts) {
    const out = await Service.joinBoxe(u, opts);
    if (out.error) return { out };
    const room = await consume(out);
    const box = { out, room, welcome: null, start: null, result: null, towel: null, replaced: false, snaps: [], ev: [] };
    room.onMessage("welcome", (m) => (box.welcome = m));
    room.onMessage("start", (m) => (box.start = m));
    room.onMessage("result", (m) => (box.result = m));
    room.onMessage("towel", (m) => (box.towel = m));
    room.onMessage("replaced", () => (box.replaced = true));
    room.onMessage("pong", () => {});
    room.onMessage("s", (m) => {
      box.snaps.push(m);
      if (box.snaps.length > 400) box.snaps.shift();
      box.ev.push(...m.ev);
    });
    await until(() => box.welcome);
    return box;
  }
  const lifeOf = async (u) => (await LifeService.peek(u)).character;

  // ── Porta e ficha ─────────────────────────────────────────────────────────
  check("o centro tem a Arena de Boxe como minijogo de 2", Center.PLACES.find((p) => p.id === "boxe").destination === "game:boxe");
  const far = await Service.boxeCard(users[0]);
  check("longe da porta: 409 far", far.statusCode === 409 && far.code === "far", JSON.stringify(far));
  const street = await Service.joinBoxe(users[7], {});
  check("fora do centro: 409", street.statusCode === 409);
  for (let i = 0; i < 7; i++) nearDoor(users[i]);
  const card = await Service.boxeCard(users[0]);
  check("ficha: pode lutar, com os números e condições da vida", card.boxe && card.boxe.ok && card.boxe.me.view.power >= 0 && card.boxe.me.conditions.length > 0, JSON.stringify(card).slice(0, 300));
  check("…3 adversários do computador (mais fraco, parelho, mais forte)", card.boxe.opponents.map((o) => o.tier).join() === "easy,even,hard");
  check("…sem os números crus do computador", !("stats" in card.boxe.opponents[0]));
  const card2 = await Service.boxeCard(users[0]);
  check("…a ficha é estável (os mesmos adversários)", card2.boxe.opponents[2].name === card.boxe.opponents[2].name);

  // ── Sozinho contra o computador ───────────────────────────────────────────
  const before = await lifeOf(users[0]);
  const S = await join(users[0], { mode: "solo", tier: "hard", strategy: "aggressive" });
  check("sozinho: larga na hora", await until(() => S.start, 3000));
  check("…eu no canto 0, o computador no 1 (o mesmo da ficha)", S.start.me === 0 && S.start.corners[1].cpu && S.start.corners[1].name === card.boxe.opponents[2].name);
  check("…estratégia e corpo da vida", S.start.corners[0].strategy === "aggressive" && typeof S.start.corners[0].body === "string");
  check("…a tabela dos golpes e o 1º estado", S.start.table && S.start.table.pieces.length >= 5 && S.start.snap && S.start.snap.f.length === 2);
  check("…o estado chega a cada passo", await until(() => S.snaps.length > 5, 3000));
  check("…o sino toca", await until(() => S.ev.some((e) => e[1] === 0), 4000));
  // o joystick anda: para o adversário, e o ATAQUE solta golpes (meus, canto 0)
  for (let i = 0; i < 40 && !S.ev.some((e) => e[1] === 2 && e[2] === 0); i++) {
    const me = S.snaps.at(-1).f[0];
    const op = S.snaps.at(-1).f[1];
    const dx = op[0] - me[0];
    const dz = op[1] - me[1];
    const d = Math.hypot(dx, dz) || 1;
    S.room.send("in", { m: [dx / d, dz / d] });
    S.room.send("in", { a: [0, 1], c: i + 1 });
    await sleep(25);
  }
  check("…o ataque do aparelho vira golpe na sala", S.ev.some((e) => e[1] === 2 && e[2] === 0), JSON.stringify(S.ev.slice(-4)));
  S.room.send("in", { m: "lixo", a: "x", d: 7, k: -1 });
  S.room.send("in", null);
  check("…resultado no fim", await until(() => S.result, 8000));
  check("…com a consequência na vida", S.result && S.result.aftermath && S.result.aftermath.delta.energy < 0, JSON.stringify(S.result && S.result.aftermath));
  const after = await lifeOf(users[0]);
  check("…energia gasta e cartel com 1 luta", after.vitals.energy < before.vitals.energy && after.boxing.w + after.boxing.l + after.boxing.d === 1, JSON.stringify(after.boxing));
  const mine = S.result.rows[0];
  check("…bolsa só na vitória", mine.outcome === "win" ? S.result.aftermath.coins === 90 : S.result.aftermath.coins === 0, `${mine.outcome} ${S.result.aftermath.coins}`);
  await bye(S.room);

  // ── Cansado não entra ─────────────────────────────────────────────────────
  await pool.query(`UPDATE tb_mm_character SET energy = 5 WHERE id_user = $1`, [users[1]]);
  const tired = await Service.joinBoxe(users[1], { mode: "solo" });
  check("cansado demais: 409 tired", tired.statusCode === 409 && tired.code === "tired", JSON.stringify(tired));
  const tiredCard = await Service.boxeCard(users[1]);
  check("…a ficha diz que não pode", tiredCard.boxe && tiredCard.boxe.ok === false && tiredCard.boxe.code === "tired");

  // ── Fechar a aba no meio não escapa ───────────────────────────────────────
  boxe._boxeTiming.speed = 40;
  const lifeQ0 = await lifeOf(users[2]);
  const Q = await join(users[2], { mode: "solo", tier: "even" });
  await until(() => Q.start, 3000);
  await bye(Q.room);
  const applied = await until(() => {
    const r = boxe._boxeRooms().find((x) => x.roomId === Q.room.roomId);
    return !r || r.applied;
  }, 9000);
  await sleep(300);
  const lifeQ1 = await lifeOf(users[2]);
  check("saiu no meio: a luta segue e vale na vida", applied && lifeQ1.boxing.w + lifeQ1.boxing.l + lifeQ1.boxing.d === 1 && lifeQ1.vitals.energy < lifeQ0.vitals.energy);
  boxe._boxeTiming.speed = 120;

  // ── Multiplayer: duas pessoas, a mesma luta; toalha ───────────────────────
  boxe._boxeTiming.speed = 4;
  const A = await join(users[3], { mode: "mp", strategy: "defensive" });
  check("multiplayer: o 1º espera, com o prazo", A.room.state.phase === "lobby" && A.welcome.left > 0);
  const Bx = await join(users[4], { mode: "mp" });
  check("…o 2º cai na mesma sala e larga na hora", Bx.room.roomId === A.room.roomId && (await until(() => A.start && Bx.start)));
  check("…cantos 0 e 1, os dois humanos", A.start.me !== Bx.start.me && !A.start.corners[0].cpu && !A.start.corners[1].cpu);
  check("…a mesma tabela e o mesmo estado", JSON.stringify(A.start.table) === JSON.stringify(Bx.start.table) && (await until(() => A.snaps.length && Bx.snaps.length && A.snaps.some((a) => Bx.snaps.some((b) => b.t === a.t && JSON.stringify(b.f) === JSON.stringify(a.f))), 3000)));
  // cada um anda o seu lutador
  await until(() => A.room.state.time > 0.5, 4000);
  const myF = (box) => box.snaps.at(-1).f[box.start.me];
  const xa0 = myF(A)[0];
  for (let i = 0; i < 20; i++) {
    A.room.send("in", { m: [A.start.me === 0 ? -1 : 1, 0] });
    await sleep(30);
  }
  check("…o joystick de um anda o lutador dele", Math.abs(myF(A)[0] - xa0) > 0.1, `${xa0} → ${myF(A)[0]}`);
  await until(() => A.room.state.time > 2, 4000);
  A.room.send("towel");
  check("toalha: chega para os dois", await until(() => A.towel && Bx.towel, 3000));
  check("…com quem jogou", A.towel.who === A.start.me);
  check("…e acaba logo", await until(() => A.result && Bx.result, 6000));
  const ra = A.result.rows[A.start.me];
  const rb = Bx.result.rows[Bx.start.me];
  check("…quem jogou perde por toalha, o outro ganha", ra.outcome === "loss" && ra.method === "towel" && rb.outcome === "win", JSON.stringify([ra, rb]));
  check("…a bolsa do multiplayer para quem ganhou", Bx.result.aftermath && Bx.result.aftermath.coins === 60);
  await bye(A.room);
  await bye(Bx.room);
  boxe._boxeTiming.speed = 120;

  // ── Multiplayer sem ninguém vira computador ───────────────────────────────
  const N = await join(users[5], { mode: "mp" });
  check("multiplayer sem ninguém: larga contra o computador parelho", await until(() => N.start, 5000));
  check("…avisado (nobody) e o outro canto é computador", N.start.nobody === true && N.start.corners[1 - N.start.me].cpu);
  await until(() => N.result, 8000);
  await bye(N.room);

  // ── Voltar para casa tira da espera ───────────────────────────────────────
  const W = await join(users[6], { mode: "mp" });
  const home = await Service.returnHome(users[6]);
  check("voltar para casa: ok", !home.error, JSON.stringify(home.error || ""));
  check("…e sai da espera (replaced)", await until(() => W.replaced));
  await bye(W.room);

  console.log(`\n${PASS} ok, ${FAIL} falha(s)`);
  await pool.end().catch(() => {});
  process.exit(FAIL ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
