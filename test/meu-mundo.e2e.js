// test/meu-mundo.e2e.js — MEU MUNDO 3D: bairro persistente + multiplayer (mig 291)
//
// Roda: TEST_DATABASE_URL=postgres://...localhost.../mm npm run test:meu-mundo
//
// ⚠️ NÃO APONTA PARA PRODUÇÃO, e recusa qualquer host que não seja local: a
// suíte COMITA de verdade (é o único jeito de provar concorrência entre
// conexões diferentes e o "reinício do servidor"). Ela cria, num banco
// descartável, um esqueleto mínimo de tb_user/tb_role/tb_user_role, aplica a
// mig 291 e usa usuários SIMULADOS (username "mmtest_*").
//
// Prova: residência persistente e idempotente, concorrência pela mesma vaga,
// limite de 20, criação de outro bairro, as restrições do banco, reinício
// sem redistribuir, e — com clientes WebSocket reais do @colyseus/sdk — dois
// moradores se vendo, isolamento entre bairros, bloqueio de quem não é admin
// ou não mora ali, segunda sessão substituindo a primeira, troca de corpo
// sincronizada, movimento validado no servidor e saída/reentrada sem duplicar.

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
async function until(fn, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await sleep(25);
  }
  return false;
}

async function bootstrap(pool) {
  await pool.query(`DROP TABLE IF EXISTS tb_mm_car_paint_owned, tb_mm_skin_owned, tb_mm_vehicle, tb_mm_visit, tb_mm_avatar_pref, tb_mm_residence, tb_mm_house, tb_mm_lot,
                    tb_mm_neighborhood, tb_user_role, tb_role, tb_user CASCADE`);
  await pool.query(`CREATE TABLE tb_user (id_user UUID PRIMARY KEY, username TEXT, email TEXT)`);
  await pool.query(`CREATE TABLE tb_role (id_role SERIAL PRIMARY KEY, desc_role TEXT, is_active BOOLEAN DEFAULT TRUE)`);
  await pool.query(`CREATE TABLE tb_user_role (id_user UUID, id_role INT, is_active BOOLEAN DEFAULT TRUE)`);
  await pool.query(`INSERT INTO tb_role (desc_role) VALUES ('Administrator')`);
  const sql = fs.readFileSync(
    path.join(__dirname, "../src/databases/migrations/291_meu_mundo_bairros.sql"),
    "utf8"
  );
  await pool.query(sql);
  await pool.query(sql); // idempotente
  const sql292 = fs.readFileSync(
    path.join(__dirname, "../src/databases/migrations/292_meu_mundo_house_levels.sql"),
    "utf8"
  );
  await pool.query(sql292);
  await pool.query(sql292); // idempotente
  const sql293 = fs.readFileSync(
    path.join(__dirname, "../src/databases/migrations/293_meu_mundo_visits.sql"),
    "utf8"
  );
  await pool.query(sql293);
  await pool.query(sql293); // idempotente
  const sql294 = fs.readFileSync(
    path.join(__dirname, "../src/databases/migrations/294_meu_mundo_body_sergio.sql"),
    "utf8"
  );
  await pool.query(sql294);
  await pool.query(sql294); // idempotente
  const sql299 = fs.readFileSync(path.join(__dirname, "../src/databases/migrations/299_meu_mundo_vehicles.sql"), "utf8");
  await pool.query(sql299);
  await pool.query(sql299); // idempotente
  const sql300 = fs.readFileSync(path.join(__dirname, "../src/databases/migrations/300_meu_mundo_skins.sql"), "utf8");
  await pool.query(sql300);
  await pool.query(sql300); // idempotente
  const sql304 = fs.readFileSync(path.join(__dirname, "../src/databases/migrations/304_meu_mundo_avatar_colors.sql"), "utf8");
  await pool.query(sql304);
  await pool.query(sql304); // idempotente (mm3d-36)
  const sql309 = fs.readFileSync(path.join(__dirname, "../src/databases/migrations/309_meu_mundo_vendedor.sql"), "utf8");
  await pool.query(sql309);
  await pool.query(sql309); // idempotente (mm3d-37e: cor do carro)
}

async function mkUser(pool, admin = true, tag = "") {
  const id = crypto.randomUUID();
  await pool.query(`INSERT INTO tb_user VALUES ($1, $2, $3)`, [
    id,
    `mmtest_${tag || id.slice(0, 6)}`,
    `${id}@mm.test`,
  ]);
  if (admin) await pool.query(`INSERT INTO tb_user_role (id_user, id_role) VALUES ($1, 1)`, [id]);
  return id;
}

async function expectViolation(pool, sql, params, label) {
  try {
    await pool.query(sql, params);
    check(label, false, "o banco aceitou");
  } catch (e) {
    check(label, ["23505", "23514"].includes(e.code), e.code + " " + e.message);
  }
}

(async () => {
  const pool = require("../src/databases");
  await bootstrap(pool);
  const Storage = require("../src/storages/MeuMundoStorage");

  // ── Persistência, idempotência e limite ──────────────────────────────────
  const a = await mkUser(pool, true, "a");
  const r1 = await Storage.ensureResidence(pool, a);
  const r2 = await Storage.ensureResidence(pool, a);
  check("primeira entrada cria a residência", r1.created === true);
  check("repetir devolve a MESMA casa", r1.residence.id_house === r2.residence.id_house && !r2.created);

  const same = await mkUser(pool, true, "same");
  const burst = await Promise.all(Array.from({ length: 8 }, () => Storage.ensureResidence(pool, same)));
  check(
    "8 pedidos simultâneos do mesmo usuário → uma residência",
    new Set(burst.map((b) => b.residence.id_house)).size === 1
  );
  const cnt = await pool.query(`SELECT COUNT(*)::int n FROM tb_mm_residence WHERE id_user=$1`, [same]);
  check("…e uma linha só no banco", cnt.rows[0].n === 1);

  const many = [];
  for (let i = 0; i < 28; i++) many.push(await mkUser(pool, true, `m${i}`));
  const res = await Promise.all(many.map((u) => Storage.ensureResidence(pool, u)));
  const houses = res.map((r) => r.residence.id_house);
  check("28 alocações concorrentes: nenhuma casa repetida", new Set(houses).size === 28);
  const nbs = await pool.query(`SELECT seq FROM tb_mm_neighborhood ORDER BY seq`);
  check("30 moradores = exatamente 2 bairros (sem bairro extra)", nbs.rows.length === 2, JSON.stringify(nbs.rows));
  const per = await pool.query(`
    SELECT n.seq, COUNT(r.*)::int n FROM tb_mm_neighborhood n
      JOIN tb_mm_lot l ON l.id_neighborhood=n.id_neighborhood
      JOIN tb_mm_house h ON h.id_lot=l.id_lot
      LEFT JOIN tb_mm_residence r ON r.id_house=h.id_house AND r.status='active'
     GROUP BY n.seq ORDER BY n.seq`);
  check("bairro 01 lotado com 20, bairro 02 com 10", per.rows[0].n === 20 && per.rows[1].n === 10, JSON.stringify(per.rows));
  const lots = await pool.query(`SELECT COUNT(*)::int n FROM tb_mm_lot`);
  check("cada bairro tem 20 lotes", lots.rows[0].n === 40);

  // ── Restrições do banco ──────────────────────────────────────────────────
  const anyNb = (await pool.query(`SELECT id_neighborhood FROM tb_mm_neighborhood WHERE seq=1`)).rows[0].id_neighborhood;
  const takenHouse = r1.residence.id_house;
  const otherHouse = res[0].residence.id_house;
  await expectViolation(pool, `INSERT INTO tb_mm_residence (id_user,id_house) VALUES ($1,$2)`, [a, otherHouse], "banco recusa 2ª residência ativa do mesmo usuário");
  const b = await mkUser(pool, true, "b");
  await expectViolation(pool, `INSERT INTO tb_mm_residence (id_user,id_house) VALUES ($1,$2)`, [b, takenHouse], "banco recusa 2º titular na mesma casa");
  await expectViolation(pool, `INSERT INTO tb_mm_lot (id_neighborhood,lot_number) VALUES ($1,21)`, [anyNb], "banco recusa lote 21 (capacidade 20)");
  await expectViolation(pool, `INSERT INTO tb_mm_lot (id_neighborhood,lot_number) VALUES ($1,5)`, [anyNb], "banco recusa lote duplicado no bairro");
  await expectViolation(pool, `UPDATE tb_mm_neighborhood SET capacity=21 WHERE seq=1`, [], "banco recusa bairro com capacidade ≠ 20");

  // ── "Reinício": pool novo, nada muda ─────────────────────────────────────
  const { Pool } = require("pg");
  const fresh = new Pool({ connectionString: url });
  const before = (await Storage.getActiveResidence(pool, a)).id_house;
  const after = (await Storage.getActiveResidence(fresh, a)).id_house;
  check("reinício não redistribui moradores", before === after);
  await fresh.end();

  // ── Multiplayer real (Colyseus + WebSocket) ──────────────────────────────
  const express = require("express");
  const realtime = require("../src/realtime/meuMundo");
  const Service = require("../src/services/MeuMundoService");
  const server = http.createServer(express());
  await new Promise((r) => server.listen(0, r));
  realtime.init(server);
  const port = server.address().port;
  const { Client } = await import("@colyseus/sdk");
  const client = new Client(`ws://127.0.0.1:${port}/mm-ws`);

  // Moradores do bairro 01 (a, many[0]) e um do bairro 02.
  const nb2user = res.find((r) => r.residence.seq === 2).residence.id_user;
  const nb1user = many.find((u, i) => res[i].residence.seq === 1 && u !== a);
  const join = async (u) => {
    const out = await Service.enter(u);
    return { out, room: await client.consumeSeatReservation(out.multiplayer.reservation) };
  };
  const A = await join(a);
  const B = await join(nb1user);
  const C = await join(nb2user);
  check("entrada devolve bairro sem e-mail nem id de usuário", !JSON.stringify(A.out.neighborhood).match(/@mm\.test|[0-9a-f]{8}-[0-9a-f]{4}-/));
  check("payload marca a própria casa", A.out.neighborhood.houses.filter((h) => h.isMine).length === 1);
  check("payload separa moradores (titulares) de online", A.out.neighborhood.residents === 20);
  check("mesmo bairro → mesma sala", A.room.roomId === B.room.roomId);
  check("bairros diferentes → salas isoladas", A.room.roomId !== C.room.roomId);
  await until(() => A.room.state.players.size === 2);
  check("A vê B (dois jogadores no bairro)", A.room.state.players.size === 2);
  await until(() => C.room.state.players.size === 1);
  check("o bairro 02 não vê ninguém do 01", C.room.state.players.size === 1);
  const pB = () => A.room.state.players.get(B.room.sessionId);
  const keysB = Object.keys(pB().toJSON ? pB().toJSON() : pB());
  // Nenhum campo fora da lista pública (st/wd só aparecem quando têm valor; look = cores, mm3d-36).
  const PUBLIC = new Set(["body", "car", "facing", "house", "look", "move", "name", "pace", "sk", "st", "wd", "x", "z"]);
  check("estado só traz campos públicos", keysB.every((k) => PUBLIC.has(k)) && keysB.includes("look"), keysB.join());

  // Movimento validado no servidor: intenção absurda não vira teleporte.
  const x0 = pB().x;
  const z0 = pB().z;
  const t0 = Date.now();
  for (let i = 0; i < 10; i++) {
    B.room.send("in", { x: 999, z: 0, r: true });
    await sleep(100);
  }
  B.room.send("in", { x: 0, z: 0 });
  await until(() => pB().move === 0, 3000);
  const dist = Math.hypot(pB().x - x0, pB().z - z0);
  const secs = (Date.now() - t0) / 1000 + 0.5;
  check("A vê B se mover", dist > 0.5, `dist=${dist}`);
  check("velocidade limitada pelo servidor", dist <= 3.5 * secs + 0.5, `dist=${dist} em ${secs}s`);

  // Tipo físico (2026-10-21): não se escolhe — a mensagem "body" é ignorada
  // e o corpo vem da VIDA (applyLife), que chega ao outro jogador.
  const body0 = pB().body;
  B.room.send("body", { body: "strong" });
  await sleep(500);
  check("escolher corpo pela sala é ignorado", pB().body === body0, pB().body);
  realtime.applyLife(nb1user, { pace: 1, status: "alive", activity: "idle", body: "fat" });
  await until(() => pB().body === "fat");
  check("corpo vindo da vida chega ao outro jogador", pB().body === "fat");
  realtime.applyLife(nb1user, { pace: 1, status: "alive", activity: "idle", body: "https://evil/x.glb" });
  await sleep(400);
  check("corpo fora da lista permitida é recusado", pB().body === "fat");
  // Sergio (mig 294): a preferência gravada continua passando pelo CHECK do banco.
  await Storage.setBody(pool, nb1user, "sergio");
  check("corpo sergio persistido (CHECK da mig 294)", (await Storage.getBody(pool, nb1user)) === "sergio");

  // ── Carros (mm3d-11) ─────────────────────────────────────────────────────
  {
    const Cars = require("../src/utils/meuMundoCars");
    const Lx = require("../src/utils/meuMundoLayout");
    const M = require("../src/utils/meuMundoMotion");
    const resB = await Storage.getActiveResidence(pool, nb1user);
    const rm = realtime._roomFor(resB.id_neighborhood);
    const lotB = resB.lot_number;
    const carOf = (n) => A.room.state.cars.get(String(n));
    await until(() => !!carOf(lotB));
    const kinds = {};
    A.room.state.cars.forEach((c) => (kinds[c.kind] = (kinds[c.kind] || 0) + 1));
    check("quatro veículos por casa com titular (20 de cada no bairro cheio)", A.room.state.cars.size === 80 && kinds.car === 20 && kinds.bike === 20 && kinds.skate === 20 && kinds.skates === 20, JSON.stringify(kinds));
    const park = Cars.parkingSpot(lotB);
    check("carro nasce na vaga da casa", Math.abs(carOf(lotB).x - park.x) < 0.01 && Math.abs(carOf(lotB).z - park.z) < 0.01);
    const simOf = (u) => [...rm.sim.values()].find((x) => x.userId === u);
    const place = (u, x, z) => Object.assign(simOf(u).body, { x, z, vx: 0, vz: 0 });
    const denied = [];
    B.room.onMessage("car_denied", (m) => denied.push(m.reason));
    B.room.onMessage("moved", () => {});

    // Longe do carro: recusado.
    const fr = Lx.frontOfHouse(lotB);
    place(nb1user, fr.x, fr.z);
    const farD = Math.hypot(fr.x - park.x, fr.z - park.z);
    if (farD > Cars.CAR.ENTER_RADIUS) {
      B.room.send("car", { a: "enter" });
      await until(() => denied.includes("far"));
      check("longe do carro: entrar é recusado", denied.includes("far") && pB().car === 0);
    }
    // Perto: entra, o carro passa a ser dirigido por ele.
    const ex = Cars.exitSpots(park, M.MOTION.RADIUS)[0];
    place(nb1user, ex.x, ex.z);
    await sleep(120);
    B.room.send("car", { a: "enter" });
    await until(() => pB().car === lotB);
    check("perto do próprio carro: entra", pB().car === lotB && carOf(lotB).driver === B.room.sessionId);
    // A (outro morador) não entra no carro de B: o servidor só oferece o da casa dele.
    // A (outro morador) perto do carro de B: o servidor só oferece o da casa de A.
    const deniedA = [];
    A.room.onMessage("car_denied", (m) => deniedA.push(m.reason));
    A.room.onMessage("moved", () => {});
    const resA2 = await Storage.getActiveResidence(pool, a);
    const parkA = Cars.parkingSpot(resA2.lot_number);
    const exB = Cars.exitSpots(carOf(lotB), M.MOTION.RADIUS)[1];
    place(a, exB.x, exB.z);
    const farFromOwn = Math.hypot(exB.x - parkA.x, exB.z - parkA.z) > Cars.CAR.ENTER_RADIUS;
    A.room.send("car", { a: "enter" });
    await until(() => deniedA.length > 0);
    check("perto do carro dos outros não entra (só o da própria casa)", farFromOwn && deniedA.includes("far") && carOf(lotB).driver === B.room.sessionId, deniedA.join());
    const inCar = await Service.enterHouse(nb1user, lotB);
    check("dirigindo, não entra em casa", inCar.statusCode === 409 && /carro/.test(inCar.error || ""), JSON.stringify(inCar));

    // Dirigindo (mm3d-12): a física do carro na sala, com a entrada "drive".
    const V = require("../src/utils/meuMundoVehicle");
    const c0 = { x: carOf(lotB).x, z: carOf(lotB).z, f: carOf(lotB).facing };
    const t1 = Date.now();
    for (let i = 0; i < 15; i++) {
      B.room.send("drive", { t: 1, b: 0, s: 0.3, h: 0 });
      await sleep(100);
    }
    const secs = (Date.now() - t1) / 1000;
    const movingSp = carOf(lotB).sp;
    // Andando, a sala recusa a saída.
    B.room.send("car", { a: "exit" });
    await sleep(300);
    check("andando, não sai do carro", denied.includes("moving") && pB().car === lotB, denied.join());
    B.room.send("drive", { t: 0, b: 1, s: 0, h: 0 });
    await until(() => Math.abs(carOf(lotB).sp) < 0.3, 6000);
    B.room.send("drive", { t: 0, b: 0, s: 0, h: 0 });
    await sleep(200);
    const driven = Math.hypot(carOf(lotB).x - c0.x, carOf(lotB).z - c0.z);
    check("carro anda com a física (velocidade e esterço na sala)", driven > 1 && movingSp > 1, `dist=${driven.toFixed(1)} sp=${movingSp.toFixed(1)}`);
    check("…e não passa da velocidade máxima", driven <= V.VEHICLE.MAX_SPEED * (secs + 0.6), `dist=${driven.toFixed(1)}`);
    check("o jogador acompanha o carro", Math.hypot(pB().x - carOf(lotB).x, pB().z - carOf(lotB).z) < 0.5);
    await until(() => pB().move === 0, 6000);

    // Sair: desce num ponto livre ao lado, o carro fica onde parou.
    const before = { x: carOf(lotB).x, z: carOf(lotB).z };
    B.room.send("car", { a: "exit" });
    await until(() => pB().car === 0);
    const box = Cars.carBox(carOf(lotB));
    const free = Lx.isSafeSpot(pB().x, pB().z, M.resolveCircle, M.MOTION.RADIUS, rm.obstacles.concat([box]));
    check("ao sair, a pessoa desce num lugar livre", pB().car === 0 && free);
    check("o carro fica onde parou", Math.hypot(carOf(lotB).x - before.x, carOf(lotB).z - before.z) < 0.05 && carOf(lotB).driver === "");

    // A pé, o carro parado é obstáculo.
    const c = carOf(lotB);
    const f = { x: Math.sin(c.facing), z: Math.cos(c.facing) };
    const r = { x: f.z, z: -f.x };
    const side = Cars.CAR.HX + M.MOTION.RADIUS + 1.2;
    place(nb1user, c.x - r.x * side, c.z - r.z * side);
    await sleep(120);
    for (let i = 0; i < 15; i++) {
      B.room.send("in", { x: r.x, z: r.z });
      await sleep(100);
    }
    B.room.send("in", { x: 0, z: 0 });
    await sleep(200);
    const lat = Math.abs((pB().x - c.x) * r.x + (pB().z - c.z) * r.z);
    check("a pé não atravessa o carro estacionado", lat >= Cars.CAR.HX + M.MOTION.RADIUS - 0.08, `lat=${lat.toFixed(2)}`);

    // Cair dirigindo: o carro fica estacionado onde estava.
    const ex2 = Cars.exitSpots(carOf(lotB), M.MOTION.RADIUS).find((e) => Lx.isSafeSpot(e.x, e.z, M.resolveCircle, M.MOTION.RADIUS, rm.obstacles.concat([Cars.carBox(carOf(lotB))])));
    place(nb1user, ex2.x, ex2.z);
    await sleep(120);
    B.room.send("car", { a: "enter" });
    await until(() => pB().car === lotB);
    const sidB = B.room.sessionId;
    rm.dropSession(sidB);
    await until(() => carOf(lotB).driver === "");
    check("quem cai dirigindo larga o carro", carOf(lotB).driver === "");
    // Volta para a sala de verdade (o resto da suíte usa B).
    await B.room.leave().catch(() => {});
    B.room = (await join(nb1user)).room;
    await until(() => A.room.state.players.size === 2, 5000);
    B.room.onMessage("car_denied", (m) => denied.push(m.reason));
    B.room.onMessage("moved", () => {});

    // ── mm3d-14: bike, skate e patins (de qualquer casa) ──
    const resA = await Storage.getActiveResidence(pool, a);
    const lotA = resA.lot_number;
    const bikeA = Cars.vehicleId("bike", lotA);
    const sp = Cars.spotFor("bike", lotA);
    check("a bike nasce na calçada da casa", Math.abs(carOf(bikeA).x - sp.x) < 0.01 && carOf(bikeA).kind === "bike");
    // B (de outra casa) usa a bike de A.
    const exb = Cars.exitSpots(carOf(bikeA), M.MOTION.RADIUS).find((e) => Lx.isSafeSpot(e.x, e.z, M.resolveCircle, M.MOTION.RADIUS, rm.obstacles));
    place(nb1user, exb.x, exb.z);
    await sleep(150);
    B.room.send("car", { a: "enter", id: bikeA });
    await until(() => pB().car === bikeA);
    check("qualquer morador usa a bike de outra casa", pB().car === bikeA && carOf(bikeA).driver === B.room.sessionId);
    check("montado na bike: move 6 (o boneco aparece pedalando)", pB().move === 6, String(pB().move));
    const b0 = { x: carOf(bikeA).x, z: carOf(bikeA).z };
    for (let i = 0; i < 12; i++) {
      B.room.send("drive", { t: 1, b: 0, s: 0, h: 0 });
      await sleep(100);
    }
    B.room.send("drive", { t: 0, b: 1, s: 0, h: 0 });
    await until(() => Math.abs(carOf(bikeA).sp) < 0.2, 6000);
    B.room.send("drive", { t: 0, b: 0, s: 0, h: 0 });
    check("a bike anda com a física (igual ao carro)", Math.hypot(carOf(bikeA).x - b0.x, carOf(bikeA).z - b0.z) > 1);
    B.room.send("car", { a: "exit" });
    await until(() => pB().car === 0);
    check("desce da bike", pB().car === 0 && carOf(bikeA).driver === "" && pB().move !== 6);
    // O carro de A continua só de A.
    const carA = carOf(lotA);
    const exc = Cars.exitSpots(carA, M.MOTION.RADIUS).find((e) => Lx.isSafeSpot(e.x, e.z, M.resolveCircle, M.MOTION.RADIUS, rm.obstacles.concat(rm.carBoxes(""))));
    place(nb1user, exc.x, exc.z);
    await sleep(150);
    denied.length = 0;
    B.room.send("car", { a: "enter", id: lotA });
    await until(() => denied.length > 0);
    check("o carro de outra casa continua recusado (só o titular)", denied.includes("not_owner") && pB().car === 0, denied.join());
    // Skate estacionado não bloqueia quem anda; patins: move 8.
    const skA = carOf(Cars.vehicleId("skate", lotA));
    check("skate estacionado não é obstáculo", !rm.carBoxes("").some((b) => Math.abs(b.x - skA.x) < 1e-6 && Math.abs(b.z - skA.z) < 1e-6));
    const ptA = Cars.vehicleId("skates", lotA);
    place(nb1user, carOf(ptA).x + 0.6, carOf(ptA).z);
    await sleep(150);
    B.room.send("car", { a: "enter", id: ptA });
    await until(() => pB().car === ptA);
    check("patins: move 8", pB().move === 8 && carOf(ptA).kind === "skates");
    B.room.send("car", { a: "exit" });
    await until(() => pB().car === 0);

    // ── mm3d-15: onde o veículo fica, continua (mig 299) ──
    const VS = require("../src/storages/MeuMundoVehicleStorage");
    const nbB = resB.id_neighborhood;
    let rowBike = null;
    await sleep(300);
    rowBike = await VS.get(pool, nbB, bikeA);
    check("a bike largada fica gravada onde parou", !!rowBike && !rowBike.houseId && Math.abs(rowBike.x - carOf(bikeA).x) < 0.01 && Math.abs(rowBike.z - carOf(bikeA).z) < 0.01, JSON.stringify(rowBike));
    const rowCar = await VS.get(pool, nbB, lotB);
    check("o carro largado também", !!rowCar && Math.abs(rowCar.x - carOf(lotB).x) < 0.01, JSON.stringify(rowCar));
    // A sala reabre (reinício do servidor): a bike volta para onde ficou, não para a vaga.
    const srv = (n) => rm.state.cars.get(String(n)); // estado da SALA (o do cliente chega no próximo patch)
    rm.state.cars.delete(String(bikeA));
    rm.saved.set(bikeA, rowBike);
    rm.ensureVehicles(lotA);
    check("sala que reabre põe a bike onde ela ficou", Math.abs(srv(bikeA).x - rowBike.x) < 0.01 && Math.abs(srv(bikeA).z - rowBike.z) < 0.01 && Math.hypot(srv(bikeA).x - sp.x, srv(bikeA).z - sp.z) > 0.5);
    // Posição de outro desenho do bairro, ou num lugar que virou obstáculo: volta à vaga.
    rm.state.cars.delete(String(bikeA));
    const blocked = rm.obstacles.find((b) => b.hx > 1 && b.hz > 1);
    rm.saved.set(bikeA, { ...rowBike, x: blocked.x, z: blocked.z });
    rm.ensureVehicles(lotA);
    check("…a não ser que o lugar não sirva mais (volta à vaga)", Math.abs(srv(bikeA).x - sp.x) < 0.01 && Math.abs(srv(bikeA).z - sp.z) < 0.01);
    // Guardado em casa não aparece na rua.
    rm.state.cars.delete(String(ptA));
    rm.indoors.add(ptA);
    rm.ensureVehicles(lotA);
    check("veículo guardado em casa não aparece na rua", !rm.state.cars.has(String(ptA)));
    rm.releaseRide(ptA, Cars.spotFor("skates", lotA));
    check("…até sair de lá", rm.state.cars.has(String(ptA)) && !rm.indoors.has(ptA));
    await expectViolation(pool, `INSERT INTO tb_mm_vehicle (id_neighborhood, vehicle_id, x, z, facing, id_house, layout)
       SELECT $1, 5, 0, 0, 0, id_house, 3 FROM tb_mm_house LIMIT 1`, [nbB], "o banco recusa carro guardado dentro de casa");
    await expectViolation(pool, `INSERT INTO tb_mm_vehicle (id_neighborhood, vehicle_id, x, z, facing, layout) VALUES ($1, 81, 0, 0, 0, 3)`, [nbB], "o banco recusa id de veículo fora de 1–80");
  }

  // ── Nível da casa (mig 292): seletor de teste 01–10 ─────────────────────
  const L = require("../src/utils/meuMundoLayout");
  const { resolveCircle, MOTION } = require("../src/utils/meuMundoMotion");
  const resA = await Storage.getActiveResidence(pool, a);
  const lotA = resA.lot_number;
  const room = realtime._roomFor(resA.id_neighborhood);
  check("catálogo tem 10 níveis, 01 é a casa embutida", L.HOUSE_CATALOG.length === 10 && L.HOUSE_CATALOG[0].kind === "builtin");
  check("nível 10 sem modelo fica indisponível", L.HOUSE_CATALOG[9].available === false);
  check("payload leva o catálogo e o nível de cada casa", A.out.neighborhood.houseCatalog?.levels?.length === 10 && A.out.neighborhood.houses.every((h) => h.level === 1));
  check("payload não traz URL absoluta de modelo", !JSON.stringify(A.out.neighborhood.houseCatalog).match(/https?:/));
  for (const bad of [0, 11, "abc", "https://evil/x.glb", 2.5, null]) {
    const r = await Service.setHouseLevel(a, bad);
    check(`nível inválido recusado (${JSON.stringify(bad)})`, r.statusCode === 400, JSON.stringify(r));
  }
  const r10 = await Service.setHouseLevel(a, 10);
  check("nível 10 (sem modelo) recusado", r10.statusCode === 409, JSON.stringify(r10));
  const noRes = await mkUser(pool, true, "nores");
  check("sem residência não troca nada", (await Service.setHouseLevel(noRes, 3)).statusCode === 409);

  // Um ponto do jardim de A: livre com a casa 01, dentro da casa 09.
  const inside = L.lotToWorld(L.LOTS[lotA - 1], 7, 0);
  check("ponto livre com o nível 01", L.isSafeSpot(inside.x, inside.z, resolveCircle, MOTION.RADIUS, room.obstacles));
  const simB = room.sim.get(B.room.sessionId);
  Object.assign(simB.body, { x: inside.x, z: inside.z, vx: 0, vz: 0 });
  simB.intent = { x: 0, z: 0, run: false };
  let movedMsg = null;
  B.room.onMessage("moved", (m) => (movedMsg = m));
  const lv9 = await Service.setHouseLevel(a, 9);
  check("troca confirmada devolve nível e revisão", lv9.level === 9 && lv9.rev === 1 && lv9.house === lotA, JSON.stringify(lv9));
  const dbLv = await pool.query(`SELECT level, level_rev FROM tb_mm_house WHERE id_house=$1`, [resA.id_house]);
  check("nível persistido no banco", dbLv.rows[0].level === 9 && dbLv.rows[0].level_rev === 1);
  const hsKey = String(lotA);
  await until(() => B.room.state.houses?.get(hsKey)?.level === 9);
  check("o outro jogador recebe o nível pela sala", B.room.state.houses.get(hsKey)?.level === 9);
  check("colisores da casa trocados na sala", room.obstacles.filter((o) => o.lot === lotA).length === L.levelDef(9).colliders.length);
  await until(() => !!movedMsg);
  check("quem ficou dentro da casa nova é avisado", !!movedMsg);
  check("…e levado para um lugar livre", L.isSafeSpot(simB.body.x, simB.body.z, resolveCircle, MOTION.RADIUS, room.obstacles));
  check("revisão antiga não sobrescreve a nova", realtime.applyHouseLevel(resA.id_neighborhood, lotA, 2, 1) === false && room.state.houses.get(hsKey).level === 9);
  const B1lot = (await Storage.getActiveResidence(pool, nb1user)).lot_number;
  const bLv = await Service.setHouseLevel(nb1user, 4);
  check("cada um troca só a PRÓPRIA casa", bLv.house === B1lot && room.state.houses.get(hsKey).level === 9);
  const quick = await Promise.all([3, 5, 7].map((n) => Service.setHouseLevel(a, n)));
  const last = quick.reduce((m, q) => (q.rev > m.rev ? q : m));
  await until(() => room.state.houses.get(hsKey).rev === last.rev);
  const dbQuick = await pool.query(`SELECT level FROM tb_mm_house WHERE id_house=$1`, [resA.id_house]);
  check("trocas rápidas: vence a última confirmada (banco = sala)", room.state.houses.get(hsKey).level === dbQuick.rows[0].level && dbQuick.rows[0].level === last.level);
  const back = await Service.setHouseLevel(a, 1);
  await until(() => room.state.houses.get(hsKey).level === 1);
  check("volta ao nível 01", room.state.houses.get(hsKey).level === 1 && room.obstacles.filter((o) => o.lot === lotA).length === 1 && back.level === 1);
  await Service.setHouseLevel(a, 6);
  const lateUser = many.find((u, i) => res[i].residence.seq === 1 && u !== a && u !== nb1user);
  const late = await Service.enter(lateUser);
  check("quem entra depois recebe o nível persistido", late.neighborhood.houses[lotA - 1].level === 6);
  check("…e os colisores dele no payload", late.neighborhood.obstacles.filter((o) => o.lot === lotA).length === L.levelDef(6).colliders.length);
  await client.consumeSeatReservation(late.multiplayer.reservation).then((r) => r.leave()).catch(() => {});
  await Service.setHouseLevel(a, 1);
  await Service.setHouseLevel(nb1user, 1);

  // Segunda sessão do mesmo usuário substitui a primeira, sem duplicar.
  let replaced = false;
  B.room.onMessage("replaced", () => (replaced = true));
  const B2 = await join(nb1user);
  await until(() => replaced && A.room.state.players.size === 2);
  check("segunda sessão: a primeira recebe aviso", replaced);
  check("segunda sessão: sem presença duplicada", A.room.state.players.size === 2);

  // Não-admin, ou reserva para bairro alheio, não entra.
  const plain = await mkUser(pool, false, "plain");
  await Storage.ensureResidence(pool, plain);
  const plainRes = await Storage.getActiveResidence(pool, plain);
  let denied = false;
  try {
    const seat = await realtime.reserveSeat({ neighborhoodId: plainRes.id_neighborhood, userId: plain, name: "x", body: "normal" });
    await client.consumeSeatReservation(seat);
  } catch {
    denied = true;
  }
  check("usuário sem papel Administrator é recusado na sala", denied);
  denied = false;
  try {
    const seat = await realtime.reserveSeat({ neighborhoodId: A.out.neighborhood && (await Storage.getActiveResidence(pool, a)).id_neighborhood, userId: nb2user, name: "x", body: "normal" });
    await client.consumeSeatReservation(seat);
  } catch {
    denied = true;
  }
  check("morador do bairro 02 não entra na sala do bairro 01", denied);

  // Sair e voltar: presença some, casa fica, reentrada não duplica.
  await B2.room.leave();
  await until(() => A.room.state.players.size === 1);
  check("sair remove a presença online", A.room.state.players.size === 1);
  check("sair não remove a residência", !!(await Storage.getActiveResidence(pool, nb1user)));
  const B3 = await join(nb1user);
  await until(() => A.room.state.players.size === 2);
  check("reentrada sem duplicar", A.room.state.players.size === 2);

  // Sala vazia é descartada; o bairro continua e a nova sala é do mesmo bairro.
  await B3.room.leave();
  await A.room.leave();
  await sleep(300);
  const st = await realtime.status();
  check("sala vazia é descartada (só sobra a do bairro 02)", st.rooms === 1, JSON.stringify(st));
  const A2 = await join(a);
  check("recriar a sala recupera a mesma casa", A2.out.me.house === A.out.me.house);
  await A2.room.leave();
  await C.room.leave();

  console.log(`\n${PASS} ok, ${FAIL} falhas`);
  await pool.query(`DROP TABLE IF EXISTS tb_mm_skin_owned, tb_mm_vehicle, tb_mm_visit, tb_mm_avatar_pref, tb_mm_residence, tb_mm_house, tb_mm_lot,
                    tb_mm_neighborhood, tb_user_role, tb_role, tb_user CASCADE`);
  process.exit(FAIL ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
