// test/meu-mundo-voltar.e2e.js — MEU MUNDO 3D: voltar onde parou (mig 463, 21/11)
//
// Roda: TEST_DATABASE_URL=postgres://...localhost.../mm npm run test:meu-mundo-voltar
//
// ⚠️ NÃO APONTA PARA PRODUÇÃO (recusa host que não seja local). Usuários SIMULADOS ("mmtest_*") e clientes
// WebSocket reais do @colyseus/sdk nas salas REAIS de bairro, casa e centro.
//
// Pedido do Alex (21/11): "quando eu saio do jogo ele sempre volta pra casa e não onde ele estava". Antes o lugar
// morava só na memória do processo (10 min, zerava no deploy). Prova: sai do jogo na rua, dentro de casa e no
// centro; o "deploy" zera a memória (presença + fila); entrar de novo volta ao MESMO ambiente e à mesma posição.
// Posição de outro desenho do lugar não vale (volta à frente da casa).

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
  if (cond) {
    PASS++;
    console.log(`✓ ${label}`);
  } else {
    FAIL++;
    console.log(`✗ ${label}${extra ? " — " + extra : ""}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (a, b, d = 0.5) => !!a && !!b && Math.hypot(a.x - b.x, a.z - b.z) < d;

// O mesmo esqueleto do e2e dos monstros: todas as migrations do Meu Mundo.
async function bootstrap(pool) {
  await pool.query(`DROP TABLE IF EXISTS tb_mm_last_place, tb_mm_god_hunt, tb_mm_statue_week, tb_mm_domain_pact, tb_mm_domain_progress, tb_mm_video, tb_mm_archive, tb_mm_trainer, tb_mm_refine_proposal, tb_mm_gear_unlock, tb_mm_quest, tb_mm_equip, tb_mm_gear, tb_mm_fight, tb_mm_receipt, tb_mm_char_adventure, tb_mm_adventure, tb_mm_artifact, tb_mm_clan,
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
  await pool.query(`INSERT INTO tb_mm_clan (id_user, clan, sex) VALUES ($1, 'raposa', 'm')`, [id]);
  return id;
}

(async () => {
  const pool = require("../src/databases");
  await bootstrap(pool);
  const Storage = require("../src/storages/MeuMundoStorage");
  const express = require("express");
  const realtime = require("../src/realtime/meuMundo");
  const presence = require("../src/realtime/meuMundoPresence");
  const lastPlace = require("../src/realtime/meuMundoLastPlace");
  const Service = require("../src/services/MeuMundoService");
  const L = require("../src/utils/meuMundoLayout");
  const Center = require("../src/utils/meuMundoCenter");
  const { interiorFor } = require("../src/utils/meuMundoInteriors");
  const { resolveCircle } = require("../src/utils/meuMundoMotion");

  const u = await mkUser(pool, "voltar");
  let lot = 0;
  let nbId = null;

  const server = http.createServer(express());
  await new Promise((r) => server.listen(0, r));
  realtime.init(server);
  const { Client } = await import("@colyseus/sdk");
  const client = new Client(`ws://127.0.0.1:${server.address().port}/mm-ws`);
  const consume = (out) => client.consumeSeatReservation(out.multiplayer.reservation);
  const bye = (room) => Promise.race([room.leave(true).catch(() => {}), sleep(400)]);
  const row = async () => (await pool.query(`SELECT * FROM tb_mm_last_place WHERE id_user = $1`, [u])).rows[0];
  /** Sai do jogo (menu), grava e simula o deploy: memória do processo zerada. */
  async function quitAndDeploy(room) {
    await bye(room);
    await sleep(250);
    await lastPlace.flush();
    presence._reset();
    lastPlace._reset();
  }
  const mySim = (r, sid) => r && r.sim.get(sid);

  // ── 1. Rua ──────────────────────────────────────────────────────────────────
  const first = await Service.enter(u);
  // A residência sai da entrada (com a classe da pessoa).
  lot = first.me.house;
  nbId = (await Storage.getActiveResidence(pool, u)).id_neighborhood;
  check("primeira entrada: rua, na frente da casa", first.scene === "neighborhood" && near(first.me.home, L.frontOfHouse(lot)));
  let nb = await consume(first);
  await sleep(150);
  const spot = L.frontOfHouse(lot === 1 ? 2 : 1);
  Object.assign(mySim(realtime._roomFor(nbId), nb.sessionId).body, { x: spot.x, z: spot.z, vx: 0, vz: 0 });
  await quitAndDeploy(nb);
  const r1 = await row();
  check("o lugar da rua vai para o banco", !!r1 && r1.scene === "nb" && r1.id_neighborhood === nbId && near(r1, spot, 0.05), JSON.stringify(r1));
  const again = await Service.enter(u);
  nb = await consume(again);
  await sleep(150);
  check("depois do deploy, volta à rua ONDE ESTAVA (não na frente da casa)", again.scene === "neighborhood" && near(mySim(realtime._roomFor(nbId), nb.sessionId).body, spot));

  // Desenho do bairro mudou: posição salva não vale.
  await quitAndDeploy(nb);
  await pool.query(`UPDATE tb_mm_last_place SET layout = layout + 1000 WHERE id_user = $1`, [u]);
  const changed = await Service.enter(u);
  nb = await consume(changed);
  await sleep(150);
  check("posição de outro desenho do bairro não vale: frente da casa", near(mySim(realtime._roomFor(nbId), nb.sessionId).body, L.frontOfHouse(lot)));

  // ── 2. Dentro de casa ───────────────────────────────────────────────────────
  {
    const def = L.levelDef(1);
    const d = def.door ?? def.origin;
    const door = L.lotToWorld(L.LOTS[lot - 1], d.x, def.origin.z - 0.6);
    Object.assign(mySim(realtime._roomFor(nbId), nb.sessionId).body, { x: door.x, z: door.z, vx: 0, vz: 0 });
    await sleep(150);
  }
  const inHouse = await Service.enterHouse(u, lot);
  check("entra em casa", inHouse.scene === "house", inHouse.error);
  let house = await consume(inHouse);
  await sleep(200);
  const houseId = presence.get(u) && presence.get(u).id;
  const idef = interiorFor(inHouse.interior.level);
  const e = idef.entry;
  let inside = null;
  for (const [dx, dz] of [[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2], [1.2, 1.2], [-1.2, -1.2]]) {
    if (realtime.isFreeSpot(idef, e.floor, e.x + dx, e.z + dz)) {
      inside = { x: e.x + dx, z: e.z + dz };
      break;
    }
  }
  check("achou um lugar livre dentro de casa (longe da porta)", !!inside);
  Object.assign(mySim(realtime._houseRoomFor(houseId), house.sessionId).body, { ...inside, vx: 0, vz: 0 });
  await quitAndDeploy(house);
  const r2 = await row();
  check("o lugar dentro de casa vai para o banco", !!r2 && r2.scene === "house" && r2.id_house === houseId, JSON.stringify(r2));
  const backIn = await Service.enter(u);
  check("depois do deploy, volta DENTRO de casa", backIn.scene === "house", backIn.scene);
  house = await consume(backIn);
  await sleep(200);
  check("…no lugar em que estava lá dentro", near(mySim(realtime._houseRoomFor(houseId), house.sessionId).body, inside));
  const out = await Service.exitHouse(u);
  check("sair de casa ainda leva à frente da casa", out.scene === "neighborhood" && near(out.me.home, L.frontOfHouse(lot)), out.error);
  nb = await consume(out);
  await sleep(200);

  // ── 3. Centro ───────────────────────────────────────────────────────────────
  const go = await Service.travelToCenter(u);
  check("vai ao centro", go.scene === "center", go.error);
  let center = await consume(go);
  await bye(nb);
  await sleep(200);
  const cRoom = () => realtime._centerRooms().find((r) => r.roomId === center.roomId);
  const a = Center.ARRIVAL || { x: -50, z: 4.1 };
  let cspot = null;
  for (const [dx, dz] of [[3, 0], [0, 3], [-3, 0], [0, -3], [5, 2]]) {
    const c = resolveCircle(a.x + dx, a.z + dz, 0.45, Center.OBSTACLES);
    if (Math.hypot(c.x - a.x - dx, c.z - a.z - dz) < 1e-3) {
      cspot = { x: a.x + dx, z: a.z + dz };
      break;
    }
  }
  check("achou um lugar livre no centro", !!cspot);
  Object.assign(mySim(cRoom(), center.sessionId).body, { ...cspot, vx: 0, vz: 0 });
  await sleep(100);
  // Sem deploy: saiu pelo menu, entra de novo → centro (antes voltava para casa).
  await bye(center);
  await sleep(250);
  const same = await Service.enter(u);
  check("saiu do jogo pelo menu no centro: volta ao CENTRO", same.scene === "center", same.sceneKey || same.error);
  center = await consume(same);
  await sleep(200);
  check("…onde estava", near(mySim(cRoom(), center.sessionId).body, cspot), JSON.stringify(mySim(cRoom(), center.sessionId)?.body));
  await quitAndDeploy(center);
  const r3 = await row();
  check("o lugar no centro vai para o banco", !!r3 && r3.scene === "center" && near(r3, cspot, 0.05), JSON.stringify(r3));
  const afterDeploy = await Service.enter(u);
  check("depois do deploy, volta ao centro", afterDeploy.scene === "center", afterDeploy.sceneKey || afterDeploy.error);
  center = await consume(afterDeploy);
  await sleep(200);
  check("…onde estava", near(mySim(cRoom(), center.sessionId).body, cspot));
  const home = await Service.returnHome(u);
  check("do centro, voltar para casa continua funcionando", home.scene === "neighborhood", home.error);
  nb = await consume(home);
  await bye(center);
  await sleep(150);

  // ── 4. Fotografia periódica (o deploy não fecha as salas) ────────────────────
  Object.assign(mySim(realtime._roomFor(nbId), nb.sessionId).body, { x: spot.x, z: spot.z, vx: 0, vz: 0 });
  await sleep(10 * 1000 + 2500);
  const r4 = await row();
  check("sem sair, a posição é gravada a cada ~10 s", !!r4 && r4.scene === "nb" && near(r4, spot, 0.05), JSON.stringify(r4));

  await bye(nb);
  console.log(`\n${PASS} ok, ${FAIL} falhas`);
  process.exit(FAIL ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
