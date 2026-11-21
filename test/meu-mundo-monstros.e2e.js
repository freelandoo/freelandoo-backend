// test/meu-mundo-monstros.e2e.js — MEU MUNDO 3D: monstros da rua perseguem e a luta abre sozinha (21/11)
//
// Roda: TEST_DATABASE_URL=postgres://...localhost.../mm npm run test:meu-mundo-monstros
//
// ⚠️ NÃO APONTA PARA PRODUÇÃO (recusa host que não seja local). Usuários SIMULADOS
// ("mmtest_*") e clientes WebSocket reais do @colyseus/sdk na sala REAL do centro,
// com MM_TEST_BOTS=1 (os 21 robôs e todos os monstros na rua a qualquer hora — a
// carga que roda no Railway).
//
// Pedido do Alex (21/11): "os monstros estão ignorando o personagem, e também não estão
// correndo e entrando na luta automático". Prova: parado PERTO (até de costas) = o monstro
// vê ("mchase"), corre e alcança ("mcatch", que abre a tela de versus no aparelho);
// ocupado (menu/minijogo — o aparelho manda `q: 1`) não é perseguido; quem perdeu fica em
// paz; os robôs não são alvo; no máximo MOBS.MAX_CHASE perseguindo ao mesmo tempo.

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
  const { MOBS } = require("../src/realtime/meuMundoMobs");
  const { resolveCircle } = require("../src/utils/meuMundoMotion");
  const Center = require("../src/utils/meuMundoCenter");

  const users = [];
  for (let i = 0; i < 3; i++) {
    const u = await mkUser(pool, `mob${i}`);
    await Storage.ensureResidence(pool, u);
    users.push(u);
  }
  const server = http.createServer(express());
  await new Promise((r) => server.listen(0, r));
  realtime.init(server);
  const { Client } = await import("@colyseus/sdk");
  const client = new Client(`ws://127.0.0.1:${server.address().port}/mm-ws`);

  /** Mensagens recebidas por usuário: [{ type, msg, at }]. */
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
  await until(() => rooms[0].state.players.size >= 3 + 21, 3000);
  const bots = [...rooms[0].state.players.keys()].filter((k) => k.startsWith("bot-")).length;
  check("MM_TEST_BOTS: os 21 robôs andam na sala", bots === 21, String(bots));
  await until(() => centro.mobDirector.mobs.size >= 5, 3000);
  check("MM_TEST_BOTS: todos os tipos de monstro na rua", centro.mobDirector.mobs.size >= 5, String(centro.mobDirector.mobs.size));

  const sidOf = (u) => centro.sidOf(u);
  /** Põe a pessoa parada num lugar livre a `dist` m do monstro, DE COSTAS para o focinho dele. */
  function standBehind(u, m, dist) {
    const s = centro.sim.get(sidOf(u));
    for (let k = 0; k < 24; k++) {
      const f = m.facing + Math.PI + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.25;
      const x = m.x + Math.sin(f) * dist;
      const z = m.z + Math.cos(f) * dist;
      const c = resolveCircle(x, z, 0.45, Center.OBSTACLES);
      if (Math.hypot(c.x - x, c.z - z) < 1e-6) {
        Object.assign(s.body, { x, z, vx: 0, vz: 0 });
        return true;
      }
    }
    return false;
  }
  const got = (u, type, since) => inbox.get(u).find((e) => e.type === type && e.at >= since);
  const wandering = () => [...centro.mobDirector.mobs.values()].filter((m) => m.mode === "wander");

  // ── 1. Parado perto, de costas: ele vê, corre e alcança (a luta abre no aparelho) ──
  const [a, b, c] = users;
  // os outros dois longe de tudo enquanto isso (ocupados)
  rooms[1].send("mfight", { q: 1 });
  rooms[2].send("mfight", { q: 1 });
  await sleep(200);
  const target = wandering()[0];
  check("jogador posto a 6 m, de costas para o monstro", standBehind(a, target, 6));
  let t0 = Date.now();
  await until(() => got(a, "mchase", t0), 3000);
  const chase = got(a, "mchase", t0);
  check('parado e de costas: o monstro percebe ("mchase")', !!chase, JSON.stringify(inbox.get(a).filter((e) => e.type !== "mobs" && e.type !== "gods").slice(-3)));
  const chaser = chase && centro.mobDirector.get(chase.msg.id);
  const ran = [];
  const tick = setInterval(() => chaser && chaser.mode === "chase" && ran.push([Date.now(), chaser.x, chaser.z]), 100);
  await until(() => got(a, "mcatch", t0), 8000);
  clearInterval(tick);
  const caught = got(a, "mcatch", t0);
  check('alcançou: "mcatch" chega e a luta abre sozinha', !!caught && caught.msg.id === (chase && chase.msg.id));
  if (ran.length > 3) {
    const [p, q] = [ran[0], ran[ran.length - 1]];
    const v = Math.hypot(q[1] - p[1], q[2] - p[2]) / ((q[0] - p[0]) / 1000);
    check(`correu a ~${MOBS.CHASE_V} m/s (clipe de correr acima de 2,4)`, v > 2.4 && v < MOBS.CHASE_V + 0.3, v.toFixed(2));
  }
  check("o monstro fica parado em luta com essa pessoa", chaser && chaser.mode === "fight" && chaser.target === sidOf(a));
  const sinceCatch = Date.now();
  // a lista "mobs" vai a todos; os robôs nunca são alvo
  check("robô nunca é alvo", [...centro.mobDirector.mobs.values()].every((m) => !String(m.target || "").startsWith("bot-")));

  // ── 2. Perdeu: o monstro solta e a pessoa fica em paz (CALM) ──
  rooms[0].send("mfight", { id: chaser.id, r: 0 });
  await until(() => chaser.mode === "wander", 2000);
  check("perdeu: o monstro volta a andar", chaser.mode === "wander");
  standBehind(a, chaser, 4);
  await sleep(2500);
  check("…e não persegue de novo quem acabou de perder", !got(a, "mchase", sinceCatch + 100) && !got(a, "mcatch", sinceCatch + 100));

  // ── 3. Ocupado (menu, minijogo): não é visto; livre de novo, é ──
  const other = wandering().find((m) => m.id !== chaser.id);
  check("jogador ocupado posto a 4 m de outro monstro", standBehind(b, other, 4));
  t0 = Date.now();
  await sleep(2500);
  check("ocupado: nenhum monstro vem", !got(b, "mchase", t0) && !got(b, "mcatch", t0));
  rooms[1].send("mfight", { q: 0 });
  await until(() => got(b, "mchase", t0), 3000);
  check('livre de novo: o monstro vem ("mchase")', !!got(b, "mchase", t0));
  await until(() => got(b, "mcatch", t0), 6000);
  check("…e alcança", !!got(b, "mcatch", t0));

  // ── 4. Limite de perseguidores ao mesmo tempo ──
  let maxChase = 0;
  const watch = setInterval(() => (maxChase = Math.max(maxChase, centro.mobDirector.chasing())), 50);
  rooms[2].send("mfight", { q: 0 });
  const third = wandering()[0];
  if (third) standBehind(c, third, 5);
  await sleep(2500);
  clearInterval(watch);
  check(`nunca mais de ${MOBS.MAX_CHASE} perseguindo ao mesmo tempo`, maxChase <= MOBS.MAX_CHASE, String(maxChase));

  for (const r of rooms) await Promise.race([r.leave(true).catch(() => {}), sleep(400)]);
  console.log(`\n${PASS} ok, ${FAIL} falhas`);
  server.close();
  await pool.end().catch(() => {});
  process.exit(FAIL ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
