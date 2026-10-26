// test/meu-mundo-centro.e2e.js — MEU MUNDO 3D: Centro da cidade (mm3d-17)
//
// Roda: TEST_DATABASE_URL=postgres://...localhost.../mm npm run test:meu-mundo-centro
//
// ⚠️ NÃO APONTA PARA PRODUÇÃO (recusa host que não seja local): cria num banco
// descartável o esqueleto mínimo e usuários SIMULADOS ("mmtest_*"). Os
// clientes são WebSocket reais do @colyseus/sdk (clientes simulados — não há
// avatar desenhado aqui; renderização é conferida no navegador).
//
// Prova: jogadores de bairros diferentes no mesmo centro; os 20 primeiros na
// mesma sala e o 21º em outra; 40 entradas SIMULTÂNEAS sem sala com 21;
// pedido repetido sem presença dupla; vaga guardada de quem caiu (sem
// duplicar ao voltar) e liberada no prazo; voltar para casa leva ao PRÓPRIO
// bairro; carro vai e volta sem duplicar nem ficar órfão; quem não é admin ou
// não foi mandado ao centro é barrado na sala; idas e voltas não acumulam.

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
// O SDK só resolve leave() no fechamento: conexão que o servidor já derrubou
// (uma presença por pessoa) nunca resolve — sair tem prazo.
const bye = (room, consented = true) => Promise.race([room.leave(consented).catch(() => {}), sleep(400)]);
async function until(fn, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await sleep(25);
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

async function mkUser(pool, admin = true, tag = "") {
  const id = crypto.randomUUID();
  await pool.query(`INSERT INTO tb_user VALUES ($1, $2, $3)`, [id, `mmtest_${tag || id.slice(0, 6)}`, `${id}@mm.test`]);
  if (admin) await pool.query(`INSERT INTO tb_user_role (id_user, id_role) VALUES ($1, 1)`, [id]);
  return id;
}

(async () => {
  const pool = require("../src/databases");
  await bootstrap(pool);
  const Storage = require("../src/storages/MeuMundoStorage");
  const express = require("express");
  const realtime = require("../src/realtime/meuMundo");
  const presence = require("../src/realtime/meuMundoPresence");
  const Service = require("../src/services/MeuMundoService");
  const Center = require("../src/utils/meuMundoCenter");
  const Cars = require("../src/utils/meuMundoCars");
  // Prazos curtos para a suíte (produção: 20 s de vaga guardada, 60 s vazia).
  realtime._centerTiming.holdMs = 4000;
  realtime._centerTiming.emptyMs = 400;

  // 45 administradores → 3 bairros (20 + 20 + 5). Um usuário comum.
  const users = [];
  for (let i = 0; i < 45; i++) users.push(await mkUser(pool, true, `c${i}`));
  const residences = [];
  for (const u of users) residences.push((await Storage.ensureResidence(pool, u)).residence);
  const nbOf = new Map(users.map((u, i) => [u, residences[i].id_neighborhood]));
  const lotOf = new Map(users.map((u, i) => [u, residences[i].lot_number]));
  const nbIds = [...new Set(residences.map((r) => r.id_neighborhood))];
  check("45 moradores em 3 bairros", nbIds.length === 3, String(nbIds.length));
  const plain = await mkUser(pool, false, "plain");

  const server = http.createServer(express());
  await new Promise((r) => server.listen(0, r));
  realtime.init(server);
  const port = server.address().port;
  const { Client } = await import("@colyseus/sdk");
  const client = new Client(`ws://127.0.0.1:${port}/mm-ws`);

  /** Sessões vivas por usuário: { nb, center }. */
  const live = new Map();
  const consume = (out) => client.consumeSeatReservation(out.multiplayer.reservation);
  async function toStreet(u) {
    const out = await Service.enter(u);
    if (out.scene !== "neighborhood") throw new Error(`esperava bairro, veio ${out.scene}`);
    const room = await consume(out);
    live.set(u, { ...(live.get(u) || {}), nb: room });
    return { out, room };
  }
  async function toCenter(u) {
    const out = await Service.travelToCenter(u);
    if (out.error) return { out };
    const room = await consume(out);
    const cur = live.get(u) || {};
    // O cliente troca de ambiente: sai do bairro (como o jogo faz ao desmontar).
    if (cur.nb) await bye(cur.nb);
    live.set(u, { center: room });
    return { out, room };
  }
  async function goHome(u) {
    const out = await Service.returnHome(u);
    if (out.error) return { out };
    const room = await consume(out);
    const cur = live.get(u) || {};
    if (cur.center) await bye(cur.center);
    live.set(u, { nb: room });
    return { out, room };
  }
  const centerRoomOf = (roomId) => realtime._centerRooms().find((r) => r.roomId === roomId);
  const peopleIn = (r) => new Set([...r.sim.values()].map((s) => s.userId)).size;

  // ── Dois bairros, um centro ───────────────────────────────────────────────
  const u1 = users.find((u) => nbOf.get(u) === nbIds[0]);
  const u2 = users.find((u) => nbOf.get(u) === nbIds[1]);
  await toStreet(u1);
  await toStreet(u2);
  const c1 = await toCenter(u1);
  const c2 = await toCenter(u2);
  check("ir ao centro devolve a cena do centro", c1.out.scene === "center" && c1.out.sceneKey.startsWith("center:"));
  check("payload do centro: 12 locais + praça, sem dado de usuário", c1.out.center.places.length === 12 && !/[0-9a-f]{8}-[0-9a-f]{4}-|@mm\.test/.test(JSON.stringify(c1.out.center)));
  check("bairros diferentes se encontram no MESMO centro", c1.room.roomId === c2.room.roomId);
  await until(() => c1.room.state.players.size === 2);
  check("cada um vê o outro na sala do centro", c1.room.state.players.size === 2);
  check("presença única: está no centro, não no bairro", presence.get(u1).scene === "center");
  check("ir ao centro não muda a residência", (await Storage.getActiveResidence(pool, u1)).id_house === residences[users.indexOf(u1)].id_house);
  check("pedir de novo estando no centro é recusado (409)", (await Service.travelToCenter(u1)).statusCode === 409);

  // ── 20 numa sala, o 21º em outra ──────────────────────────────────────────
  const rest = users.filter((u) => u !== u1 && u !== u2).slice(0, 19);
  for (const u of rest) await toStreet(u);
  const seq = [];
  for (const u of rest) seq.push(await toCenter(u));
  const firstRoom = c1.room.roomId;
  const inFirst = seq.filter((s) => s.room && s.room.roomId === firstRoom).length;
  check("os primeiros 20 ocupam a mesma sala", inFirst === 18, `na primeira: ${inFirst + 2}`);
  const twentyFirst = seq[seq.length - 1];
  check("o 21º vai para outra sala", twentyFirst.room && twentyFirst.room.roomId !== firstRoom);
  check("a primeira sala tem exatamente 20", peopleIn(centerRoomOf(firstRoom)) === 20);
  check("a primeira sala trava em 20 (maxClients)", centerRoomOf(firstRoom).hasReachedMaxClients());

  // ── Voltar para casa: o PRÓPRIO bairro ────────────────────────────────────
  const h2 = await goHome(u2);
  check("voltar para casa leva ao bairro da residência", h2.out.sceneKey === `nb:${nbOf.get(u2)}`);
  check("…na frente da própria casa", h2.out.me.house === lotOf.get(u2));
  check("…e a sala do centro abre a vaga", peopleIn(centerRoomOf(firstRoom)) === 19);
  check("voltar sem estar no centro é recusado", (await Service.returnHome(u2)).statusCode === 409);

  // Todo mundo volta; as salas vazias fecham depois do prazo.
  for (const u of [u1, ...rest]) await goHome(u);
  await until(() => realtime._centerRooms().length === 0, 3000);
  check("salas vazias do centro são encerradas após o prazo", realtime._centerRooms().length === 0, String(realtime._centerRooms().length));

  // ── 40 entradas simultâneas ───────────────────────────────────────────────
  const forty = users.slice(0, 40);
  for (const u of forty) if (!live.get(u) || !live.get(u).nb) await toStreet(u);
  const outs = await Promise.all(forty.map((u) => Service.travelToCenter(u)));
  check("40 pedidos simultâneos: todos reservados", outs.every((o) => !o.error), JSON.stringify(outs.filter((o) => o.error).slice(0, 2)));
  const byRoom = new Map();
  for (const o of outs) if (!o.error) byRoom.set(o.multiplayer.reservation.roomId, (byRoom.get(o.multiplayer.reservation.roomId) || 0) + 1);
  check("nenhuma sala com mais de 20 reservas", [...byRoom.values()].every((n) => n <= 20), JSON.stringify([...byRoom.values()]));
  check("40 → duas salas de 20", byRoom.size === 2 && [...byRoom.values()].every((n) => n === 20), JSON.stringify([...byRoom.values()]));
  const withTimeout = (p, ms) => Promise.race([p, sleep(ms).then(() => null)]);
  const rooms40 = await Promise.all(outs.map((o) => withTimeout(consume(o).catch((e) => ({ err: String(e && e.message) })), 15000)));
  const bad40 = rooms40.map((r, i) => [i, r]).filter(([, r]) => !r || r.err);
  check("as 40 conexões entram", bad40.length === 0, JSON.stringify(bad40.slice(0, 3)));
  for (let i = 0; i < forty.length; i++) {
    const cur = live.get(forty[i]);
    if (cur && cur.nb) await bye(cur.nb);
    live.set(forty[i], { center: rooms40[i] });
  }
  await sleep(300);
  check("conectados: nenhuma sala com 21", realtime._centerRooms().every((r) => r.clients.length <= 20 && peopleIn(r) <= 20), realtime._centerRooms().map((r) => r.clients.length).join(","));
  const extra = users[40];
  await toStreet(extra);
  const third = await toCenter(extra);
  check("com as duas cheias, o próximo abre uma terceira", third.room && !byRoom.has(third.room.roomId));

  // ── Vaga guardada e reconexão ─────────────────────────────────────────────
  const dropper = forty[0];
  const dropRoomId = live.get(dropper).center.roomId;
  const dr = centerRoomOf(dropRoomId);
  await bye(live.get(dropper).center, false); // caiu (sem consentir)
  await until(() => dr.holds.has(dropper), 2000);
  check("quem cai tem a vaga guardada", dr.holds.has(dropper) && dr.maxClients === 19, `max=${dr.maxClients}`);
  check("…e o avatar sai da sala (sem fantasma)", peopleIn(dr) === 19);
  // Outro chega enquanto a vaga está guardada: não pega a vaga dele.
  await goHome(extra);
  const meanwhile = await toCenter(extra);
  check("com a vaga guardada, quem chega vai para outra sala", meanwhile.room && meanwhile.room.roomId !== dropRoomId);
  const rc = await Service.reconnect(dropper);
  check("reconectar no prazo volta à MESMA sala", rc.sceneKey === `center:${dropRoomId}`, rc.sceneKey || rc.error);
  const back = await client.consumeSeatReservation(rc.multiplayer.reservation);
  live.set(dropper, { center: back });
  await sleep(200);
  check("…sem duplicar o avatar", peopleIn(dr) === 20 && [...dr.sim.values()].filter((s) => s.userId === dropper).length === 1);
  check("…e a sala segue com 20 (nunca 21)", dr.clients.length === 20 && dr.maxClients === 20);
  // Cair e não voltar: a vaga se solta no prazo.
  await bye(live.get(dropper).center, false);
  await until(() => dr.holds.has(dropper), 2000);
  await until(() => !dr.holds.has(dropper), 7000);
  check("vaga guardada expira e é liberada", !dr.holds.has(dropper) && dr.maxClients === 20);
  const late = await Service.enter(dropper);
  check("depois do prazo, entrar volta para casa", late.sceneKey === `nb:${nbOf.get(dropper)}`, late.sceneKey);
  live.set(dropper, { nb: await consume(late) });
  // Caiu e escolheu "Voltar para casa": a vaga se solta NA HORA (não no fim do
  // prazo) e a sala volta a aceitar quem chega (mm3d-19).
  const again = await toCenter(dropper);
  check("de volta ao centro, na mesma sala (a mais cheia)", again.room && again.room.roomId === dropRoomId);
  await bye(again.room, false);
  await until(() => dr.holds.has(dropper), 2000);
  const homeOut = await goHome(dropper);
  await sleep(50);
  check("caiu e voltou para casa: a vaga guardada se solta na hora", !homeOut.out.error && !dr.holds.has(dropper) && dr.maxClients === 20 && !dr.locked, `max=${dr.maxClients} locked=${dr.locked}`);
  await goHome(extra);
  const joins = await toCenter(extra);
  check("…e quem chega entra nessa sala, não numa nova", joins.room && joins.room.roomId === dropRoomId);
  await goHome(extra);

  // ── Pedido repetido ───────────────────────────────────────────────────────
  const rep = forty[5];
  await goHome(rep);
  const both = await Promise.all([Service.travelToCenter(rep), Service.travelToCenter(rep)]);
  const okOnes = both.filter((o) => !o.error);
  check("dois pedidos simultâneos do mesmo usuário: um só vale", okOnes.length === 1 && both.some((o) => o.statusCode === 409));
  const repRoom = await consume(okOnes[0]);
  await bye(live.get(rep).nb);
  live.set(rep, { center: repRoom });
  await sleep(200);
  const repCount = realtime._centerRooms().reduce((n, r) => n + [...r.sim.values()].filter((s) => s.userId === rep).length, 0);
  check("…e uma presença só no centro", repCount === 1);

  // ── Acesso: só admin, só quem o servidor mandou ───────────────────────────
  const plainRes = await Storage.ensureResidence(pool, plain);
  presence.setPlacement(plain, { scene: "center", roomId: null });
  let denied = false;
  try {
    const seat = await realtime.reserveCenterSeat({ userId: plain, name: "x", body: "normal" });
    await client.consumeSeatReservation(seat);
  } catch {
    denied = true;
  }
  check("quem não é admin é barrado na sala do centro", denied && !!plainRes);
  const sneaky = users[42];
  presence.setPlacement(sneaky, { scene: "nb", nbId: nbOf.get(sneaky) });
  denied = false;
  try {
    const seat = await realtime.reserveCenterSeat({ userId: sneaky, name: "x", body: "normal" });
    await client.consumeSeatReservation(seat);
  } catch {
    denied = true;
  }
  check("reserva sem passar pela viagem do servidor é barrada", denied);
  check("sair de casa direto para o centro é recusado (precisa estar na rua)", (await Service.travelToCenter(users[43])).statusCode === 409);

  // ── Veículos ──────────────────────────────────────────────────────────────
  const driver = users[41]; // bairro 3, ainda não usado
  await toStreet(driver);
  const nbRoom = realtime._roomFor(nbOf.get(driver));
  const carId = Cars.vehicleId("car", lotOf.get(driver));
  const sid = live.get(driver).nb.sessionId;
  const spot = nbRoom.state.cars.get(String(carId));
  const sim = nbRoom.sim.get(sid);
  Object.assign(sim.body, { x: spot.x + 2, z: spot.z });
  live.get(driver).nb.send("car", { a: "enter", id: carId });
  await until(() => nbRoom.state.cars.get(String(carId)).driver === sid);
  check("entra no próprio carro no bairro", nbRoom.state.cars.get(String(carId)).driver === sid);
  const departed = { x: spot.x, z: spot.z };
  const dc = await toCenter(driver);
  check("vai ao centro dirigindo: o carro sai da rua do bairro", !nbRoom.state.cars.has(String(carId)) && realtime.isAway(nbOf.get(driver), carId));
  const cr = centerRoomOf(dc.room.roomId);
  const mine = [...cr.state.cars.entries()].find(([, c]) => c.driver === dc.room.sessionId);
  check("…e chega dentro dele no centro", !!mine && mine[1].kind === "car");
  check("…num lugar livre de chegada", !!mine && Cars.carFits(mine[1].x, mine[1].z, mine[1].facing, Center.OBSTACLES, "car"));
  check("o carro existe numa sala só (nenhuma cópia em outro centro)", realtime._centerRooms().reduce((n, r) => n + [...r.origin.values()].filter((o) => o.id === carId && o.nbId === nbOf.get(driver)).length, 0) === 1);
  // Outra pessoa no centro não usa o carro dele.
  const other = [...cr.sim.values()].find((s) => s.userId !== driver);
  if (other) {
    const oc = [...cr.clients].find((c) => cr.sim.get(c.sessionId) === other);
    const otherClientRoom = [...live.values()].map((v) => v.center).find((r) => r && r.sessionId === (oc && oc.sessionId));
    if (otherClientRoom) {
      Object.assign(other.body, { x: mine[1].x + 2, z: mine[1].z });
      live.get(driver).center.send("car", { a: "exit" });
      await until(() => !cr.state.cars.get(mine[0]).driver);
      const denials = [];
      otherClientRoom.onMessage("car_denied", (p) => denials.push(p.reason));
      otherClientRoom.send("car", { a: "enter", id: Number(mine[0]) });
      await sleep(300);
      check("no centro só o dono usa o veículo que trouxe", !cr.state.cars.get(mine[0]).driver && denials.includes("not_owner"), denials.join());
      // Volta a dirigir para o teste de volta.
      const ds = cr.sim.get(dc.room.sessionId);
      Object.assign(ds.body, { x: cr.state.cars.get(mine[0]).x + 2, z: cr.state.cars.get(mine[0]).z });
      live.get(driver).center.send("car", { a: "enter", id: Number(mine[0]) });
      await until(() => cr.state.cars.get(mine[0]).driver === dc.room.sessionId);
    }
  }
  const hd = await goHome(driver);
  await sleep(300);
  const nbRoom2 = realtime._roomFor(nbOf.get(driver));
  const back2 = nbRoom2.state.cars.get(String(carId));
  check("volta para casa dirigindo: o carro reaparece no bairro", !!back2 && !realtime.isAway(nbOf.get(driver), carId));
  check("…com a pessoa dentro", !!back2 && back2.driver === hd.room.sessionId, back2 && back2.driver);
  check("…na vaga da casa", !!back2 && Math.hypot(back2.x - Cars.spotFor("car", lotOf.get(driver)).x, back2.z - Cars.spotFor("car", lotOf.get(driver)).z) < 0.5);
  check("…e sumiu do centro", !cr.state.cars.has(mine[0]) && ![...cr.origin.values()].some((o) => o.id === carId));
  // Sair do jogo no centro com o carro estacionado lá: ele volta para onde saiu.
  const dc2 = await toCenter(driver);
  const cr2 = centerRoomOf(dc2.room.roomId);
  const parked = { ...[...cr2.state.cars.values()].find((c) => c.driver === dc2.room.sessionId) };
  live.get(driver).center.send("car", { a: "exit" });
  await sleep(300);
  await bye(live.get(driver).center); // fechou o jogo pelo menu
  await sleep(300);
  check("saiu do jogo pelo menu: a próxima entrada é em casa", (await Service.enter(driver)).sceneKey === `nb:${nbOf.get(driver)}`);
  live.set(driver, {});
  await toStreet(driver);
  const home3 = realtime._roomFor(nbOf.get(driver)).state.cars.get(String(carId));
  check("saiu do jogo no centro: o carro volta ao bairro", !!home3 && !realtime.isAway(nbOf.get(driver), carId), JSON.stringify(parked && parked.kind));
  check("…na posição em que saiu de lá", !!home3 && Math.hypot(home3.x - Cars.spotFor("car", lotOf.get(driver)).x, home3.z - Cars.spotFor("car", lotOf.get(driver)).z) < 0.5);
  check("…e não fica nenhum carro órfão no centro", realtime._centerRooms().every((r) => ![...r.origin.values()].some((o) => o.id === carId)));
  void departed;

  // Viagem que falha (centro indisponível) devolve o veículo e a pessoa à origem.
  const nbRoom3 = realtime._roomFor(nbOf.get(driver));
  const s3 = nbRoom3.sim.get(live.get(driver).nb.sessionId);
  const sp3 = nbRoom3.state.cars.get(String(carId));
  Object.assign(s3.body, { x: sp3.x + 2, z: sp3.z });
  live.get(driver).nb.send("car", { a: "enter", id: carId });
  await until(() => nbRoom3.state.cars.get(String(carId)).driver === live.get(driver).nb.sessionId);
  const orig = realtime.reserveCenterSeat;
  realtime.reserveCenterSeat = async () => {
    throw new Error("simulada");
  };
  const failed = await Service.travelToCenter(driver);
  realtime.reserveCenterSeat = orig;
  check("falha ao reservar o centro: erro claro (503)", failed.statusCode === 503);
  check("…o veículo volta ao bairro, no mesmo lugar", nbRoom3.state.cars.has(String(carId)) && !realtime.isAway(nbOf.get(driver), carId));
  check("…e o destino autorizado continua sendo o bairro", presence.getPlacement(driver).scene === "nb");

  // ── Idas e voltas repetidas não acumulam ──────────────────────────────────
  const walker = users[44];
  if (!live.get(walker) || !live.get(walker).nb) await toStreet(walker);
  const counts = [];
  for (let i = 0; i < 5; i++) {
    await toCenter(walker);
    await goHome(walker);
    await sleep(100);
    counts.push(realtime._centerRooms().reduce((n, r) => n + [...r.sim.values()].filter((s) => s.userId === walker).length + r.holds.size, 0));
  }
  check("5 idas e voltas: nenhuma presença ou vaga sobrando no centro", counts.every((n) => n === 0), counts.join(","));
  check("…e uma presença ativa só (no bairro)", presence.get(walker) && presence.get(walker).scene === "nb");

  const st = await realtime.status();
  check("status mostra as salas do centro", typeof st.centerRooms === "number");

  for (const v of live.values()) for (const r of Object.values(v)) if (r) await bye(r);
  console.log(`\n${PASS} ok, ${FAIL} falhas`);
  // Sem DROP no fim: a suíte das casas usa as tabelas da vida que ficam (como depois da suíte da vida).
  process.exit(FAIL ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
