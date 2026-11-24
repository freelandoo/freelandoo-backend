// test/meu-mundo-coliseu.e2e.js — MEU MUNDO 3D: o COLISEU (2026-11-24), luta direta na porta do antigo Boxe.
//
// Roda: TEST_DATABASE_URL=postgres://...localhost.../mm npm run test:meu-mundo-coliseu
//
// ⚠️ NÃO APONTA PARA PRODUÇÃO (recusa host que não seja local). Usuários SIMULADOS
// ("mmtest_*") e clientes WebSocket reais do @colyseus/sdk na sala REAL do centro, com
// MM_TEST_BOTS=1 (a carga do Railway).
//
// Pedido do Alex: perto do Coliseu, com outra pessoa perto, aparece "Lutar" em cima dela; o toque
// leva OS DOIS para a mesma luta, sem aceite. Prova: os dois recebem "dgo" (um é o adversário do
// outro); longe da porta, robô e ocupado são recusados ("dno"); o estado de um chega ao outro;
// pancada só depois dos dois prontos, limitada; vida zero acaba com vencedor e perdedor; desistir
// e sair da sala dão a vitória ao outro.

const url = process.env.TEST_DATABASE_URL;
if (!url || !/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("TEST_DATABASE_URL precisa apontar para um Postgres LOCAL e descartável.");
  process.exit(2);
}
process.env.DATABASE_URL = url;
process.env.DATABASE_SSL = "false";
process.env.MM_TEST_BOTS = "1";

const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");

let PASS = 0;
let FAIL = 0;
function check(label, cond, extra = "") {
  if (cond) {
    PASS++;
    console.log(`✓ ${label}`);
  } else {
    FAIL++;
    console.log(`✗ ${label}${extra ? " — " + extra : ""}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await sleep(25);
  }
  return false;
}

// O mesmo esqueleto do e2e do deus solto (test/meu-mundo-deus.e2e.js): todas as migrations do Meu Mundo.
async function bootstrap(pool) {
  await pool.query(`DROP TABLE IF EXISTS tb_mm_god_hunt, tb_mm_statue_week, tb_mm_domain_pact, tb_mm_domain_progress, tb_mm_video, tb_mm_archive, tb_mm_trainer, tb_mm_refine_proposal, tb_mm_gear_unlock, tb_mm_quest, tb_mm_equip, tb_mm_gear, tb_mm_fight, tb_mm_receipt, tb_mm_char_adventure, tb_mm_adventure, tb_mm_artifact, tb_mm_clan,
                    tb_mm_car_paint_owned, tb_mm_consume_key, tb_mm_pantry, tb_mm_skin_owned, tb_mm_character_event,
                    tb_mm_character_day, tb_mm_character, tb_mm_wallet, tb_mm_notice, tb_mm_mail,
                    tb_mm_visit, tb_mm_avatar_pref, tb_mm_residence, tb_mm_house, tb_mm_lot,
                    tb_mm_neighborhood, tb_user_role, tb_role, tb_user CASCADE`);
  await pool.query(`CREATE TABLE tb_user (id_user UUID PRIMARY KEY, username TEXT, email TEXT)`);
  await pool.query(`CREATE TABLE tb_role (id_role SERIAL PRIMARY KEY, desc_role TEXT, is_active BOOLEAN DEFAULT TRUE)`);
  await pool.query(`CREATE TABLE tb_user_role (id_user UUID, id_role INT, is_active BOOLEAN DEFAULT TRUE)`);
  await pool.query(`INSERT INTO tb_role (desc_role) VALUES ('Administrator')`);
  await require("./helpers/mmPolens").polenTables(pool);
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
  // lore v2: sem classe não entra no bairro
  await pool.query(`INSERT INTO tb_mm_clan (id_user, clan, sex) VALUES ($1, 'raposa', 'm')`, [id]);
  return id;
}


(async () => {
  const pool = require("../src/databases");
  await bootstrap(pool);
  const Storage = require("../src/storages/MeuMundoStorage");
  const express = require("express");
  const realtime = require("../src/realtime/meuMundo");
  const Service = require("../src/services/MeuMundoService");
  const { DUEL } = require("../src/realtime/meuMundoDuel");
  const { resolveCircle } = require("../src/utils/meuMundoMotion");
  const Center = require("../src/utils/meuMundoCenter");

  const users = [];
  for (let i = 0; i < 3; i++) {
    const u = await mkUser(pool, `col${i}`);
    await Storage.ensureResidence(pool, u);
    users.push(u);
  }
  const server = http.createServer(express());
  await new Promise((r) => server.listen(0, r));
  realtime.init(server);
  const { Client } = await import("@colyseus/sdk");
  const client = new Client(`ws://127.0.0.1:${server.address().port}/mm-ws`);

  const inbox = new Map();
  async function toCenter(u) {
    const nb = await client.consumeSeatReservation((await Service.enter(u)).multiplayer.reservation);
    nb.onMessage("*", () => {});
    const out = await Service.travelToCenter(u);
    const room = await client.consumeSeatReservation(out.multiplayer.reservation);
    await Promise.race([nb.leave(true).catch(() => {}), sleep(400)]);
    const box = [];
    inbox.set(u, box);
    room.onMessage("*", (type, msg) => box.push({ type, msg, at: Date.now() }));
    return room;
  }
  const rooms = [];
  for (const u of users) rooms.push(await toCenter(u));
  const centro = realtime._centerRooms().find((r) => r.roomId === rooms[0].roomId);
  check("os três no mesmo centro", rooms.every((r) => r.roomId === rooms[0].roomId) && !!centro);
  for (const r of rooms) r.send("mfight", { q: 0 });
  const [a, b, c] = users;
  const [ra, rb, rc] = rooms;
  const sid = (u) => centro.sidOf(u);
  const door = Center.PLACES.find((p) => p.id === "boxe").door;
  /** Põe a pessoa parada num lugar livre perto de (x, z). */
  function put(u, x, z) {
    const s = centro.sim.get(sid(u));
    for (let k = 0; k < 60; k++) {
      const ang = k * 0.7;
      const rr = k * 0.15;
      const px = x + Math.cos(ang) * rr;
      const pz = z + Math.sin(ang) * rr;
      const q = resolveCircle(px, pz, 0.45, Center.OBSTACLES);
      if (Math.hypot(q.x - px, q.z - pz) < 1e-6) {
        Object.assign(s.body, { x: px, z: pz, vx: 0, vz: 0 });
        s.intent = { x: 0, z: 0, run: false };
        return true;
      }
    }
    return false;
  }
  const got = (u, type, since) => inbox.get(u).find((e) => e.type === type && e.at >= since);
  // a porta olha para o leste (fachada "e"): a calçada fica em x maior
  check("A posto na frente do Coliseu", put(a, door.x + 3, door.z));
  check("B posto perto de A", put(b, door.x + 5, door.z + 1.5));
  check("C posto longe da porta", put(c, door.x + DUEL.near + 12, door.z));

  // ── 1. Recusas ──
  let t0 = Date.now();
  ra.send("duel", { to: sid(c) });
  await until(() => got(a, "dno", t0), 2000);
  check('longe da porta: recusado ("dno" far)', got(a, "dno", t0)?.msg.e === "far", JSON.stringify(got(a, "dno", t0)?.msg));
  await sleep(1600);
  const bot = [...centro.state.players.keys()].find((k) => k.startsWith("bot-"));
  check("MM_TEST_BOTS: há robôs na sala", !!bot);
  if (bot) {
    t0 = Date.now();
    ra.send("duel", { to: bot });
    await until(() => got(a, "dno", t0), 2000);
    check('robô de teste: recusado ("dno" bot)', got(a, "dno", t0)?.msg.e === "bot", JSON.stringify(got(a, "dno", t0)?.msg));
    await sleep(1600);
  }
  rb.send("mfight", { q: 1 });
  await sleep(200);
  t0 = Date.now();
  ra.send("duel", { to: sid(b) });
  await until(() => got(a, "dno", t0), 2000);
  check('ocupado (menu/minijogo): recusado ("dno" busy)', got(a, "dno", t0)?.msg.e === "busy");
  rb.send("mfight", { q: 0 });
  await sleep(1600);

  // ── 2. Lutar: os dois entram juntos, sem aceite ──
  t0 = Date.now();
  ra.send("duel", { to: sid(b) });
  await until(() => got(a, "dgo", t0) && got(b, "dgo", t0), 2000);
  const ga = got(a, "dgo", t0);
  const gb = got(b, "dgo", t0);
  check('quem tocou recebe "dgo" com o outro de adversário', !!ga && ga.msg.foe.sid === sid(b) && ga.msg.side === 0, JSON.stringify(ga?.msg));
  check('o outro entra SEM aceitar ("dgo" chega a ele também)', !!gb && gb.msg.foe.sid === sid(a) && gb.msg.side === 1);
  check("a mesma luta para os dois", !!ga && !!gb && ga.msg.id === gb.msg.id);
  check("o adversário vem com nome e corpo", !!ga && typeof ga.msg.foe.name === "string" && !!ga.msg.foe.body);
  check("os dois ficam ocupados (monstro da rua não persegue)", centro.sim.get(sid(a)).mobBusy && centro.sim.get(sid(b)).mobBusy);
  t0 = Date.now();
  rc.send("duel", { to: sid(a) });
  await until(() => got(c, "dno", t0), 2000);
  check("quem já está lutando não é chamado de novo", ["busy", "far"].includes(got(c, "dno", t0)?.msg.e));

  // ── 3. Estado de um chega ao outro; pancada só com os dois prontos ──
  t0 = Date.now();
  ra.send("dst", { x: 1.5, z: -4, f: 0.3, s: "attack", t: 0.1, c: 1, v: 2 });
  await until(() => got(b, "dst", t0), 2000);
  check("o estado de A chega a B", got(b, "dst", t0)?.msg.s === "attack" && got(b, "dst", t0)?.msg.x === 1.5);
  check("…e não volta para A", !got(a, "dst", t0));
  ra.send("dhit", { d: 20 });
  await sleep(300);
  check("pancada antes dos dois prontos não vale", !got(b, "dhurt", t0));
  ra.send("dready", { m: 200 });
  rb.send("dready", { m: 120 });
  await until(() => got(a, "dlive", t0) && got(b, "dlive", t0), 2000);
  check('os dois prontos: "dlive" para os dois', !!got(a, "dlive", t0) && !!got(b, "dlive", t0));
  check("vida de cada um pelo aparelho", got(a, "dlive", t0)?.msg.me === 200 && got(a, "dlive", t0)?.msg.foe === 120);
  t0 = Date.now();
  ra.send("dhit", { d: 999, h: 1 });
  await until(() => got(b, "dhurt", t0), 2000);
  const cap = Math.round(120 * DUEL.hitCap);
  check(`pancada limitada a ${cap} (35% da vida de quem leva)`, got(b, "dhurt", t0)?.msg.d === cap && got(b, "dhurt", t0)?.msg.h === 1);
  await until(() => got(a, "dhp", t0) && got(b, "dhp", t0), 2000);
  check("vida nova para os dois", got(a, "dhp", t0)?.msg.foe === 120 - cap && got(b, "dhp", t0)?.msg.me === 120 - cap);

  // ── 4. Vida zero: vencedor e perdedor ──
  t0 = Date.now();
  for (let i = 0; i < 6 && !got(a, "dend", t0); i++) {
    ra.send("dhit", { d: 40 });
    await sleep(150);
  }
  await until(() => got(a, "dend", t0) && got(b, "dend", t0), 2000);
  check('nocaute: A vence ("dend" win 1)', got(a, "dend", t0)?.msg.win === 1 && got(a, "dend", t0)?.msg.r === "ko");
  check("…e B perde", got(b, "dend", t0)?.msg.win === 0);
  check("acabou: os dois livres para outra", !centro.duels.busy(sid(a)) && !centro.duels.busy(sid(b)));

  // ── 5. Desistir dá a vitória ao outro ──
  for (const r of rooms) r.send("mfight", { q: 0 });
  await sleep(1600);
  t0 = Date.now();
  rb.send("duel", { to: sid(a) });
  await until(() => got(a, "dgo", t0) && got(b, "dgo", t0), 2000);
  check("B chama A de volta: os dois entram", !!got(a, "dgo", t0) && !!got(b, "dgo", t0));
  ra.send("dready", { m: 100 });
  rb.send("dready", { m: 100 });
  await sleep(200);
  t0 = Date.now();
  ra.send("dquit", {});
  await until(() => got(b, "dend", t0) && got(a, "dend", t0), 2000);
  check("A desistiu: B vence", got(b, "dend", t0)?.msg.win === 1 && got(b, "dend", t0)?.msg.r === "quit" && got(a, "dend", t0)?.msg.win === 0);

  // ── 6. Saiu da sala no meio: o outro vence ──
  for (const r of rooms) r.send("mfight", { q: 0 });
  await sleep(1600);
  put(a, door.x + 3, door.z);
  put(b, door.x + 5, door.z + 1.5);
  t0 = Date.now();
  ra.send("duel", { to: sid(b) });
  await until(() => got(b, "dgo", t0), 2000);
  ra.send("dready", { m: 100 });
  rb.send("dready", { m: 100 });
  await sleep(200);
  t0 = Date.now();
  await Promise.race([rb.leave(true).catch(() => {}), sleep(600)]);
  await until(() => got(a, "dend", t0), 3000);
  check("B saiu da sala: A vence", got(a, "dend", t0)?.msg.win === 1 && got(a, "dend", t0)?.msg.r === "drop");

  for (const r of [ra, rc]) await Promise.race([r.leave(true).catch(() => {}), sleep(400)]);
  console.log(`\n${PASS} ok, ${FAIL} falhas`);
  server.close();
  await pool.end().catch(() => {});
  process.exit(FAIL ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
