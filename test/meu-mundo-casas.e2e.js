// test/meu-mundo-casas.e2e.js — MEU MUNDO 3D mm3d-09: interiores, assentos,
// convites e visitas, com clientes WebSocket REAIS do @colyseus/sdk.
//
// Roda: TEST_DATABASE_URL=postgres://...localhost.../mm npm run test:meu-mundo-casas
// Mesma regra da suíte do bairro: só Postgres LOCAL e descartável (comita).

const url = process.env.TEST_DATABASE_URL;
if (!url || !/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("TEST_DATABASE_URL precisa apontar para um Postgres LOCAL e descartável.");
  process.exit(2);
}
process.env.DATABASE_URL = url;
process.env.DATABASE_SSL = "false";
// Tolerâncias curtas para o teste (os padrões de produto são 5 min / 60 s).
process.env.MM_VISIT_GRACE_S = "2";
process.env.MM_INVITE_TTL_S = "300";
process.env.MM_INVITES_PER_MIN = "50";

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

async function bootstrap(pool) {
  await pool.query(`DROP TABLE IF EXISTS tb_mm_visit, tb_mm_avatar_pref, tb_mm_residence, tb_mm_house, tb_mm_lot,
                    tb_mm_neighborhood, tb_user_role, tb_role, tb_user CASCADE`);
  await pool.query(`CREATE TABLE tb_user (id_user UUID PRIMARY KEY, username TEXT, email TEXT)`);
  await pool.query(`CREATE TABLE tb_role (id_role SERIAL PRIMARY KEY, desc_role TEXT, is_active BOOLEAN DEFAULT TRUE)`);
  await pool.query(`CREATE TABLE tb_user_role (id_user UUID, id_role INT, is_active BOOLEAN DEFAULT TRUE)`);
  await pool.query(`INSERT INTO tb_role (desc_role) VALUES ('Administrator')`);
  for (const f of ["291_meu_mundo_bairros.sql", "292_meu_mundo_house_levels.sql", "293_meu_mundo_visits.sql", "294_meu_mundo_body_sergio.sql"]) {
    const sql = fs.readFileSync(path.join(__dirname, "../src/databases/migrations", f), "utf8");
    await pool.query(sql);
    await pool.query(sql); // idempotente
  }
}

async function mkUser(pool, tag, admin = true) {
  const id = crypto.randomUUID();
  await pool.query(`INSERT INTO tb_user VALUES ($1, $2, $3)`, [id, `mmc_${tag}`, `${id}@mm.test`]);
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
  const L = require("../src/utils/meuMundoLayout");
  const { interiorFor } = require("../src/utils/meuMundoInteriors");

  // Bairro 01 lotado (anfitrião, vizinho, outro vizinho + 17), bairro 02 com o visitante.
  const host = await mkUser(pool, "host");
  const nb1 = await mkUser(pool, "vizinho");
  const other = await mkUser(pool, "outro");
  for (let i = 0; i < 17; i++) await Storage.ensureResidence(pool, await mkUser(pool, `f${i}`));
  for (const u of [host, nb1, other]) await Storage.ensureResidence(pool, u);
  const far = await mkUser(pool, "longe");
  await Storage.ensureResidence(pool, far);
  const R = {};
  for (const [k, u] of Object.entries({ host, nb1, other, far })) R[k] = await Storage.getActiveResidence(pool, u);
  check("visitante mora em outro bairro", R.far.id_neighborhood !== R.host.id_neighborhood && R.nb1.id_neighborhood === R.host.id_neighborhood);

  const server = http.createServer(express());
  await new Promise((r) => server.listen(0, r));
  realtime.init(server);
  const { Client } = await import("@colyseus/sdk");
  const client = new Client(`ws://127.0.0.1:${server.address().port}/mm-ws`);

  const rooms = new Map(); // user → room do cliente
  const inbox = new Map(); // user → mensagens
  const hook = (u, room) => {
    rooms.set(u, room);
    const box = inbox.get(u) || [];
    inbox.set(u, box);
    for (const t of ["visits", "visit_ended", "seat", "stood", "welcome", "replaced"]) room.onMessage(t, (m) => box.push({ t, m }));
    room.onLeave((code) => {
      room.__closed = true;
      box.push({ t: "leave", m: code });
    });
  };
  const consume = async (u, out) => {
    const prev = rooms.get(u);
    // Sala já fechada pelo servidor: leave() nunca resolveria.
    if (prev && !prev.__closed) await Promise.race([prev.leave().catch(() => {}), sleep(500)]);
    const room = await client.consumeSeatReservation(out.multiplayer.reservation);
    hook(u, room);
    await sleep(80);
    return room;
  };
  const doorOf = (lot, level) => {
    const def = L.levelDef(level);
    const d = def.door ?? def.origin;
    return L.lotToWorld(L.LOTS[lot - 1], d.x, def.origin.z - 0.6);
  };
  const teleportStreet = (u, p) => {
    const here = presence.get(u);
    const room = realtime._roomFor(here.id);
    for (const s of room.sim.values()) if (s.userId === u) Object.assign(s.body, { x: p.x, z: p.z, vx: 0, vz: 0 });
  };
  const houseSim = (u) => {
    const here = presence.get(u);
    const room = realtime._houseRoomFor(here.id);
    for (const s of room.sim.values()) if (s.userId === u) return { room, s };
    return null;
  };
  const bye = (r) => (r && !r.__closed ? Promise.race([r.leave().catch(() => {}), sleep(500)]) : null);
  const got = (u, t) => (inbox.get(u) || []).filter((x) => x.t === t);

  // ── Entrar na própria casa ────────────────────────────────────────────────
  for (const u of [host, nb1, other, far]) await consume(u, await Service.enter(u));
  const lot = R.host.lot_number;
  // Fundo do lote: longe da porta E da placa (as duas dão acesso ao menu).
  {
    const back = L.lotToWorld(L.LOTS[lot - 1], 0, 8);
    const room = realtime._roomFor(presence.get(host).id);
    for (const s of room.sim.values()) if (s.userId === host) Object.assign(s.body, { x: back.x, z: back.z, vx: 0, vz: 0 });
    await sleep(120);
  }
  const tooFar = await Service.enterHouse(host, lot);
  check("entrar longe da porta é recusado (posição do servidor)", tooFar.statusCode === 409, JSON.stringify(tooFar));
  // Perto da PLACA também vale: é ali que a tela oferece o menu da casa.
  teleportStreet(host, L.lotToWorld(L.LOTS[lot - 1], L.LOT_PLAN.sign.x - 1.3, L.LOT_PLAN.access.z + 1.2));
  await sleep(120);
  const bySign = await Service.enterHouse(host, lot);
  check("perto da placa o titular entra", bySign.scene === "house", bySign.error);
  if (bySign.scene === "house") {
    await consume(host, bySign);
    await consume(host, await Service.exitHouse(host));
  }
  teleportStreet(host, doorOf(lot, 1));
  await sleep(120);
  const inHouse = await Service.enterHouse(host, lot);
  check("titular perto da porta entra sem convite", inHouse.scene === "house" && inHouse.interior?.level === 1, inHouse.error);
  check("payload da casa: titular, nível, bairro e número", inHouse.house?.ownerName === "mmc_host" && inHouse.house.number === lot && inHouse.house.level === 1 && !!inHouse.house.neighborhoodName);
  check("payload da casa sem e-mail nem id de usuário", !JSON.stringify(inHouse).match(/@mm\.test|"(id_user|owner_id)"/));
  const streetRoom = realtime._roomFor(R.host.id_neighborhood);
  await consume(host, inHouse);
  await until(() => ![...streetRoom.sim.values()].some((s) => s.userId === host));
  check("ao entrar, o avatar sai da rua (uma presença por pessoa)", ![...streetRoom.sim.values()].some((s) => s.userId === host));
  check("presença do titular = casa", presence.get(host)?.scene === "house");

  // Vizinho sem convite, e reserva forjada.
  teleportStreet(nb1, doorOf(lot, 1));
  await sleep(120);
  const nb1Try = await Service.enterHouse(nb1, lot);
  check("vizinho sem convite é bloqueado", nb1Try.statusCode === 403, JSON.stringify(nb1Try));
  let forged = false;
  try {
    const seat = await realtime.reserveHouseSeat({ houseId: R.host.id_house, userId: nb1, name: "x", body: "normal" });
    const r = await client.consumeSeatReservation(seat);
    await r.leave();
  } catch {
    forged = true;
  }
  check("reserva forjada para a casa alheia é recusada na sala", forged);

  // Troca de nível bloqueada com gente dentro.
  const blocked = await Service.setHouseLevel(host, 5);
  check("troca de nível bloqueada com alguém dentro", blocked.statusCode === 409 && blocked.code === "occupied", JSON.stringify(blocked));

  // ── Assentos ───────────────────────────────────────────────────────────────
  const def1 = interiorFor(1);
  const seat = def1.seats[0];
  const H = houseSim(host);
  Object.assign(H.s.body, { x: 1.7, z: 3.5 }); // no banheiro, longe do sofá
  rooms.get(host).send("sit", { seat: seat.id });
  await until(() => got(host, "seat").length);
  check("sentar longe do assento é recusado", got(host, "seat")[0]?.m.ok === false && got(host, "seat")[0].m.reason === "far");
  Object.assign(H.s.body, { x: seat.stand.x, z: seat.stand.z });
  rooms.get(host).send("sit", { seat: seat.id });
  await until(() => got(host, "seat").length >= 2);
  const hp = () => H.room.state.players.get(rooms.get(host).sessionId);
  check("sentar perto: confirmado e sincronizado (move 3, assento)", got(host, "seat")[1]?.m.ok === true && hp().seat === seat.id && hp().move === 3);
  rooms.get(host).send("in", { x: 1, z: 0 });
  await sleep(300);
  check("sentado não anda", Math.hypot(hp().x - seat.x, hp().z - seat.z) < 1e-3);
  rooms.get(host).send("in", { x: 0, z: 0 });
  rooms.get(host).send("stand", {});
  await until(() => got(host, "stood").length);
  check("levantar: vai ao ponto livre e libera o assento", hp().seat === "" && hp().move === 0 && Math.hypot(hp().x - seat.stand.x, hp().z - seat.stand.z) < 0.05);

  // ── Convites ───────────────────────────────────────────────────────────────
  const self = await Service.invite(host, "mmc_host");
  check("convidar a si mesmo é recusado", self.statusCode === 400);
  const ghost = await Service.invite(host, "mmc_ninguem");
  check("pessoa inexistente: recusado", ghost.statusCode === 404);
  const plain = await mkUser(pool, "comum", false);
  await Storage.ensureResidence(pool, plain);
  check("quem não tem acesso ao Meu Mundo não pode ser convidado", (await Service.invite(host, "mmc_comum")).statusCode === 403);
  const cands = await Service.inviteCandidates(host);
  check("candidatos: só online, sem o próprio, só nome público", cands.candidates.some((c) => c.name === "mmc_longe") && !cands.candidates.some((c) => c.name === "mmc_host") && !JSON.stringify(cands).match(/@mm\.test|[0-9a-f]{8}-[0-9a-f]{4}-/));

  const inv1 = await Service.invite(host, "mmc_longe");
  check("convite enviado fica pendente", inv1.visit?.outgoing?.status === "pending", JSON.stringify(inv1));
  await until(() => got(far, "visits").some((x) => x.m.incoming.length === 1));
  const incoming = got(far, "visits").slice(-1)[0]?.m.incoming[0];
  check("o convidado recebe na experiência: anfitrião, bairro e número", incoming?.hostName === "mmc_host" && incoming.house === lot && !!incoming.neighborhoodName);
  check("um convite pendente por anfitrião", (await Service.invite(host, "mmc_outro")).code === "host_busy");
  check("cancelar o pendente", (await Service.cancel(host, incoming.id)).ok === true);
  check("aceitar cancelado falha claramente", (await Service.accept(far, incoming.id)).statusCode === 410);

  await Service.invite(host, "mmc_longe");
  let st = await Service.visitState(far);
  check("recusar", (await Service.decline(far, st.incoming[0].id)).ok === true);
  await Service.invite(host, "mmc_longe");
  st = await Service.visitState(far);
  await pool.query(`UPDATE tb_mm_visit SET expires_at = NOW() - INTERVAL '1 second' WHERE id_visit = $1`, [st.incoming[0].id]);
  await Service.sweepVisits();
  const exp = await pool.query(`SELECT status FROM tb_mm_visit WHERE id_visit = $1`, [st.incoming[0].id]);
  check("convite vencido expira", exp.rows[0].status === "expired");
  check("aceitar expirado falha claramente", (await Service.accept(far, st.incoming[0].id)).statusCode === 410);

  // Aceitação concorrente: duas abas aceitando o mesmo convite.
  await Service.invite(host, "mmc_longe");
  st = await Service.visitState(far);
  const vid = st.incoming[0].id;
  const both = await Promise.all([Service.accept(far, vid), Service.accept(far, vid)]);
  const oks = both.filter((r) => !r.error);
  check("aceitar duas vezes ao mesmo tempo cria UMA visita", oks.length === 1 && both.some((r) => r.statusCode === 409 || r.statusCode === 410), JSON.stringify(both.map((b) => b.error || "ok")));
  const actives = await pool.query(`SELECT COUNT(*)::int n FROM tb_mm_visit WHERE status = 'active'`);
  check("…e uma linha ativa no banco", actives.rows[0].n === 1);
  const acc = oks[0];
  check("de outro bairro: transferido para a rua do anfitrião", acc.stay === false && acc.scene?.scene === "neighborhood" && acc.scene.me.visitor === true && acc.scene.sceneKey === `nb:${R.host.id_neighborhood}`);
  const arrive = L.frontOfHouse(lot);
  check("…chegando na calçada da casa visitada", Math.hypot(acc.scene.me.home.x - arrive.x, acc.scene.me.home.z - arrive.z) < 0.01);
  await consume(far, acc.scene);
  const visitorSim = [...streetRoom.sim.values()].find((s) => s.userId === far);
  check("visitante entra na sala do bairro visitado", !!visitorSim && visitorSim.visitor === true);
  check("visitante não aparece como dono de casa", streetRoom.state.players.get(rooms.get(far).sessionId)?.house === 0);
  check("visitar não muda a residência", (await Storage.getActiveResidence(pool, far)).id_house === R.far.id_house);
  check("visita ativa: anfitrião não convida outra pessoa", (await Service.invite(host, "mmc_outro")).code === "host_busy");
  check("visitante não convida ninguém", (await Service.invite(far, "mmc_outro")).statusCode === 409);

  // O visitante só entra na casa autorizada.
  const otherLot = R.other.lot_number;
  teleportStreet(far, doorOf(otherLot, 1));
  await sleep(120);
  check("convite não abre outra casa", (await Service.enterHouse(far, otherLot)).statusCode === 403);
  teleportStreet(far, doorOf(lot, 1));
  await sleep(120);
  const farIn = await Service.enterHouse(far, lot);
  check("convidado autorizado entra na casa", farIn.scene === "house" && farIn.me.role === "guest", farIn.error);
  await consume(far, farIn);
  const HR = realtime._houseRoomFor(R.host.id_house);
  await until(() => HR.state.players.size === 2);
  check("titular e convidado na MESMA sala do interior", HR.state.players.size === 2);
  teleportStreet(other, doorOf(lot, 1));
  await sleep(120);
  check("outra pessoa continua bloqueada", (await Service.enterHouse(other, lot)).statusCode === 403);

  // Dois jogadores, um assento.
  const F = houseSim(far);
  const s2 = def1.seats[1];
  Object.assign(H.s.body, { x: s2.stand.x, z: s2.stand.z });
  Object.assign(F.s.body, { x: s2.stand.x, z: s2.stand.z });
  rooms.get(host).send("sit", { seat: s2.id });
  rooms.get(far).send("sit", { seat: s2.id });
  await until(() => got(far, "seat").length && got(host, "seat").length >= 3);
  const lastSeat = [got(host, "seat").slice(-1)[0]?.m, got(far, "seat").slice(-1)[0]?.m];
  check("dois jogadores não ocupam o mesmo assento", lastSeat.filter((m) => m?.ok).length === 1 && lastSeat.some((m) => m?.reason === "taken"), JSON.stringify(lastSeat));
  await bye(rooms.get(host));
  rooms.delete(host);
  await until(() => HR.state.players.size === 1);
  check("sair da casa libera o assento", ![...HR.sim.values()].some((s) => s.seat === s2.id));

  // Atualização da página: o convidado volta para dentro da casa visitada.
  const reload = await Service.enter(far);
  check("atualizar a página dentro da tolerância volta à casa autorizada", reload.scene === "house" && reload.sceneKey === `house:${R.host.id_house}`);
  await consume(far, reload);

  // Anfitrião volta para a rua do próprio bairro: a visita continua.
  presence.setPlacement(host, { scene: "nb", nbId: R.host.id_neighborhood, arrivalLot: lot });
  await consume(host, await Service.enter(host));
  await Service.sweepVisits();
  check("anfitrião na rua do bairro: a visita continua", (await Service.visitState(host)).active?.status === "active");

  // Anfitrião encerra: o convidado é avisado e levado para o próprio bairro.
  const act = (await Service.visitState(host)).active;
  check("encerrar a visita", (await Service.endVisit(host, act.id)).ok === true);
  await until(() => got(far, "visit_ended").length && got(far, "leave").some((x) => x.m === 4011));
  check("convidado avisado e retirado da casa (4011)", got(far, "visit_ended").length > 0 && got(far, "leave").some((x) => x.m === 4011));
  const back = await Service.enter(far);
  check("…e volta à frente da própria casa, no próprio bairro", back.scene === "neighborhood" && back.sceneKey === `nb:${R.far.id_neighborhood}` && Math.hypot(back.me.home.x - L.frontOfHouse(R.far.lot_number).x, back.me.home.z - L.frontOfHouse(R.far.lot_number).z) < 0.01);
  check("a autorização temporária não fica: sala do bairro visitado recusa", await (async () => {
    try {
      const seat = await realtime.reserveSeat({ neighborhoodId: R.host.id_neighborhood, userId: far, name: "x", body: "normal" });
      const r = await client.consumeSeatReservation(seat);
      await r.leave();
      return false;
    } catch {
      return true;
    }
  })());
  await consume(far, back);

  // Vizinho convidado (mesmo bairro): sem transferência; "voltar para casa" encerra.
  await Service.invite(host, "mmc_vizinho");
  const nbInv = (await Service.visitState(nb1)).incoming[0];
  const nbAcc = await Service.accept(nb1, nbInv.id);
  check("vizinho convidado: sem transferência desnecessária", nbAcc.stay === true);
  teleportStreet(nb1, doorOf(lot, 1));
  await sleep(120);
  const nbIn = await Service.enterHouse(nb1, lot);
  check("vizinho com convite entra", nbIn.scene === "house");
  await consume(nb1, nbIn);
  const nbBack = await Service.endVisit(nb1, nbInv.id);
  check("'voltar para casa' encerra e devolve à rua do próprio bairro", nbBack.ok && nbBack.scene?.scene === "neighborhood" && nbBack.scene.sceneKey === `nb:${R.nb1.id_neighborhood}`);
  await consume(nb1, nbBack.scene);

  // Desconexão: reconectar dentro da tolerância mantém; depois dela, encerra.
  await Service.invite(host, "mmc_longe");
  const v3 = (await Service.visitState(far)).incoming[0];
  const acc3 = await Service.accept(far, v3.id);
  await consume(far, acc3.scene);
  await bye(rooms.get(far));
  rooms.delete(far);
  await sleep(600);
  await consume(far, await Service.enter(far));
  await Service.sweepVisits();
  check("visitante reconecta dentro da tolerância: visita mantida", (await Service.visitState(far)).active?.status === "active");
  await bye(rooms.get(far));
  rooms.delete(far);
  await sleep(2400);
  await Service.sweepVisits();
  check("visitante fora além da tolerância: visita encerrada", (await Service.visitState(host)).active === null);
  const back3 = await Service.enter(far);
  check("…e quem volta depois cai no próprio bairro", back3.sceneKey === `nb:${R.far.id_neighborhood}`);
  await consume(far, back3);

  // Anfitrião desconecta além da tolerância.
  await Service.invite(host, "mmc_longe");
  const v4 = (await Service.visitState(far)).incoming[0];
  await consume(far, (await Service.accept(far, v4.id)).scene);
  await bye(rooms.get(host));
  rooms.delete(host);
  await sleep(2400);
  await Service.sweepVisits();
  await until(() => got(far, "leave").filter((x) => x.m === 4011).length >= 2);
  check("anfitrião fora além da tolerância: visita encerrada e visitante devolvido", (await Service.visitState(far)).active === null && got(far, "leave").filter((x) => x.m === 4011).length >= 2);

  // "Reinício do servidor": presença zerada → visitas vivas terminam após a tolerância.
  await consume(host, await Service.enter(host));
  await consume(far, await Service.enter(far));
  await Service.invite(host, "mmc_longe");
  const v5 = (await Service.visitState(far)).incoming[0];
  await consume(far, (await Service.accept(far, v5.id)).scene);
  for (const [u, r] of rooms) {
    await bye(r);
    rooms.delete(u);
  }
  presence._reset();
  await sleep(2400);
  await Service.sweepVisits();
  const v5row = await pool.query(`SELECT status FROM tb_mm_visit WHERE id_visit = $1`, [v5.id]);
  check("após reinício, visita sem ninguém conectado termina", v5row.rows[0].status === "ended");
  const afterBoot = await Service.enter(far);
  check("…e o visitante volta a um destino seguro (próprio bairro)", afterBoot.sceneKey === `nb:${R.far.id_neighborhood}`);

  // ── Os nove níveis: entrar, interior certo, sair ─────────────────────────
  await consume(host, await Service.enter(host));
  for (let level = 1; level <= 9; level++) {
    await Service.setHouseLevel(host, level);
    teleportStreet(host, doorOf(lot, level));
    await sleep(120);
    const r = await Service.enterHouse(host, lot);
    const ok = r.scene === "house" && r.interior.level === level && r.interior.floors.length === interiorFor(level).floors.length && r.interior.seats.length >= 2;
    check(`nível ${String(level).padStart(2, "0")}: entra no interior correspondente`, ok, r.error);
    if (!ok) continue;
    await consume(host, r);
    const hs = houseSim(host);
    const d = interiorFor(level);
    // Escada (quando houver): subir andando pela sala do servidor.
    if (d.stairs.length) {
      const stp = d.stairs[0];
      const mid = { x: (stp.x0 + stp.x1) / 2, z: (stp.z0 + stp.z1) / 2 };
      const back = { "+z": [0, -1], "-z": [0, 1], "+x": [-1, 0], "-x": [1, 0] }[stp.dir];
      const len = stp.dir.endsWith("z") ? stp.z1 - stp.z0 : stp.x1 - stp.x0;
      Object.assign(hs.s.body, { x: mid.x + back[0] * (len / 2 + 0.7), z: mid.z + back[1] * (len / 2 + 0.7), floor: stp.from, vx: 0, vz: 0 });
      rooms.get(host).send("in", { x: -back[0], z: -back[1] });
      await until(() => hs.s.body.floor === stp.to, 6000);
      rooms.get(host).send("in", { x: 0, z: 0 });
      check(`nível ${String(level).padStart(2, "0")}: sobe a escada no servidor`, hs.s.body.floor === stp.to);
      Object.assign(hs.s.body, { x: d.exit.x, z: d.exit.z, floor: 0 });
      hs.s.body.y = 0;
    } else {
      Object.assign(hs.s.body, { x: d.exit.x, z: d.exit.z });
    }
    await sleep(80);
    const out = await Service.exitHouse(host);
    check(`nível ${String(level).padStart(2, "0")}: sai pela porta para a frente da casa`, out.scene === "neighborhood" && Math.hypot(out.me.home.x - L.frontOfHouse(lot).x, out.me.home.z - L.frontOfHouse(lot).z) < 0.01, out.error);
    await consume(host, out);
  }

  // Saída longe da porta é recusada.
  await Service.setHouseLevel(host, 4);
  teleportStreet(host, doorOf(lot, 4));
  await sleep(120);
  await consume(host, await Service.enterHouse(host, lot));
  const hs4 = houseSim(host);
  Object.assign(hs4.s.body, { x: 0, z: 9 });
  await sleep(80);
  check("sair longe da porta é recusado", (await Service.exitHouse(host)).statusCode === 409);

  const st2 = await realtime.status();
  check("status mostra salas de casa", st2.houseRooms >= 1, JSON.stringify(st2));

  console.log(`\n${PASS} ok, ${FAIL} falhas`);
  for (const r of rooms.values()) await bye(r);
  Service.stopSweeper();
  await pool.query(`DROP TABLE IF EXISTS tb_mm_visit, tb_mm_avatar_pref, tb_mm_residence, tb_mm_house, tb_mm_lot,
                    tb_mm_neighborhood, tb_user_role, tb_role, tb_user CASCADE`);
  process.exit(FAIL ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
