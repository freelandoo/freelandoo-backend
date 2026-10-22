// test/meu-mundo-vida.e2e.js — MEU MUNDO 3D mm3d-13: a vida do hóspede no
// banco (mig 295) e na sala da casa (deitar, dormir, levantar, voltar para a
// cama ao reconectar, ritmo de caminhada), com clientes WebSocket REAIS.
//
// Roda: TEST_DATABASE_URL=postgres://...localhost.../mm npm run test:meu-mundo-vida
// Mesma regra das outras suítes do Meu Mundo: só Postgres LOCAL e descartável.
// O "tempo passando" é simulado recuando os carimbos gravados no banco.

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
async function until(fn, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await sleep(25);
  }
  return false;
}

async function bootstrap(pool) {
  await pool.query(`DROP TABLE IF EXISTS tb_mm_skin_owned, tb_mm_character_event, tb_mm_character_day, tb_mm_character, tb_mm_wallet,
                    tb_mm_visit, tb_mm_avatar_pref, tb_mm_residence, tb_mm_house, tb_mm_lot,
                    tb_mm_neighborhood, tb_user_role, tb_role, tb_user CASCADE`);
  await pool.query(`CREATE TABLE tb_user (id_user UUID PRIMARY KEY, username TEXT, email TEXT)`);
  await pool.query(`CREATE TABLE tb_role (id_role SERIAL PRIMARY KEY, desc_role TEXT, is_active BOOLEAN DEFAULT TRUE)`);
  await pool.query(`CREATE TABLE tb_user_role (id_user UUID, id_role INT, is_active BOOLEAN DEFAULT TRUE)`);
  await pool.query(`INSERT INTO tb_role (desc_role) VALUES ('Administrator')`);
  for (const f of [
    "291_meu_mundo_bairros.sql",
    "292_meu_mundo_house_levels.sql",
    "293_meu_mundo_visits.sql",
    "294_meu_mundo_body_sergio.sql",
    "295_meu_mundo_vida.sql",
    "297_meu_mundo_atributos_1000.sql",
    "298_meu_mundo_atributos_inicio_baixo.sql",
    "299_meu_mundo_vehicles.sql",
    "300_meu_mundo_skins.sql",
  ]) {
    const sql = fs.readFileSync(path.join(__dirname, "../src/databases/migrations", f), "utf8");
    await pool.query(sql);
    await pool.query(sql); // idempotente
  }
}

async function mkUser(pool, tag) {
  const id = crypto.randomUUID();
  await pool.query(`INSERT INTO tb_user VALUES ($1, $2, $3)`, [id, `mmv_${tag}`, `${id}@mm.test`]);
  await pool.query(`INSERT INTO tb_user_role (id_user, id_role) VALUES ($1, 1)`, [id]);
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
  const Life = require("../src/services/MeuMundoLifeService");
  const L = require("../src/utils/meuMundoLayout");
  const { interiorFor } = require("../src/utils/meuMundoInteriors");
  const { PACE } = require("../src/utils/meuMundoLife");

  const host = await mkUser(pool, "host");
  await Storage.ensureResidence(pool, host);
  const res = await Storage.getActiveResidence(pool, host);
  const char = async () => (await pool.query(`SELECT * FROM tb_mm_character WHERE id_user = $1 AND status = 'alive'`, [host])).rows[0];
  const coins = async () => Number((await pool.query(`SELECT coins FROM tb_mm_wallet WHERE id_user = $1`, [host])).rows[0].coins);

  // ── Nascimento e leitura ────────────────────────────────────────────────────
  const outs = await Promise.all([1, 2, 3, 4, 5].map(() => Life.peek(host)));
  const n = (await pool.query(`SELECT COUNT(*)::int AS n FROM tb_mm_character WHERE id_user = $1`, [host])).rows[0].n;
  check("5 leituras simultâneas fazem nascer UM hóspede", n === 1, `nasceram ${n}`);
  check("todas leem o mesmo hóspede", outs.every((o) => o.character.generation === 1));
  // Tipo físico (2026-10-21): nasce muito magro e a leitura grava o corpo do avatar.
  check("nasce muito magro", outs[0].character.body.bodyHint === "slim" && outs[0].character.body.fatPct < 11, JSON.stringify(outs[0].character.body));
  check("ler a vida grava o tipo físico do avatar", (await Storage.getBody(pool, host)) === "slim");
  const g = await Life.get(host);
  check("GET: geração 1 viva, carteira 500, catálogo e relógio", g.character.status === "alive" && g.wallet.coins === 500 && g.catalog.items.length >= 30 && g.catalog.clock.meals.join() === "10,14,18,22");
  check("GET: diário de hoje e evento de nascimento", g.days.length === 1 && g.days[0].closed === false && g.events.some((e) => e.kind === "born"));
  check("GET: sem semente nem ids internos", !JSON.stringify(g).match(/"seed"|id_character|id_user|@mm\.test/));

  // ── Comer, carteira ──────────────────────────────────────────────────────────
  await pool.query(`UPDATE tb_mm_character SET satiety = 30 WHERE id_user = $1`, [host]);
  const ate = await Life.consume(host, "prato_integral");
  check("comer cobra o preço e enche", ate.consumed?.price === 34 && ate.wallet.coins === 466 && ate.character.vitals.satiety > 70, JSON.stringify(ate.error || ate.wallet));
  await pool.query(`UPDATE tb_mm_wallet SET coins = 1 WHERE id_user = $1`, [host]);
  await pool.query(`UPDATE tb_mm_character SET satiety = 30 WHERE id_user = $1`, [host]);
  const broke = await Life.consume(host, "salmao_legumes");
  check("sem moedas: 402 e nada muda", broke.statusCode === 402 && broke.code === "coins" && (await coins()) === 1 && (await char()).satiety < 31);
  check("item inexistente: 404", (await Life.consume(host, "nada")).statusCode === 404);
  await pool.query(`UPDATE tb_mm_wallet SET coins = 500 WHERE id_user = $1`, [host]);

  // ── Atividade com horas, tempo passando com o jogo fechado ─────────────────
  check("deitar pela rota pede cama", (await Life.setActivity(host, "lying", 2)).code === "bed");
  check("horas fora da faixa são recusadas", (await Life.setActivity(host, "studying", 500)).code === "hours");
  const st = await Life.setActivity(host, "studying", 8);
  check("estudar 8 h: atividade gravada com o fim", st.character.activity.kind === "studying" && st.character.activity.remainingH === 8);
  const int0 = (await char()).intelligence;
  await pool.query(
    `UPDATE tb_mm_character SET sim_at = sim_at - interval '9 hours', activity_started_at = activity_started_at - interval '9 hours',
            activity_until = activity_until - interval '9 hours', energy = 100, satiety = 100 WHERE id_user = $1`,
    [host]
  );
  const back = await Life.get(host);
  check("9 h depois: estudou, ficou mais inteligente, voltou a ficar à toa", back.character.activity.kind === "idle" && back.character.attributes.intelligence > int0 + 2, `${int0} → ${back.character.attributes.intelligence}`);
  check("linha do tempo registra o fim da atividade", back.events.some((e) => e.kind === "activity_end"));

  // Escala 0–1000 (mig 297): GET traz pisos, picos e as horas úteis do dia.
  const sc = await Life.get(host);
  const at = sc.character.attributes;
  check(
    "atributos 0–1000 com pico, piso e horas úteis",
    at.intelligence > 10 && at.intelligence < 100 && at.peaks.intelligence >= at.intelligence && Math.abs(at.floors.strength - 0.6 * at.peaks.strength) < 0.02 &&
      at.usefulToday.studying.cap === 5 && at.usefulToday.studying.done >= 0 && at.usefulToday.studying.done <= 5 && sc.catalog.attributes.max === 1000,
    JSON.stringify(at)
  );
  // Linha antiga (escala 0–100, sem pico): a 297 multiplica por 10 UMA vez.
  await pool.query(`UPDATE tb_mm_character SET intelligence = 25, strength = 30, speed = 20, attr_peaks = NULL WHERE id_user = $1 AND status = 'alive'`, [host]);
  const mig297 = fs.readFileSync(path.join(__dirname, "../src/databases/migrations/297_meu_mundo_atributos_1000.sql"), "utf8");
  await pool.query(mig297);
  await pool.query(mig297);
  const conv = await char();
  check("mig 297: ×10 uma vez só e pico preenchido", conv.intelligence === 250 && conv.strength === 300 && conv.speed === 200 && conv.attr_peaks?.strength === 300, JSON.stringify([conv.intelligence, conv.strength, conv.attr_peaks]));
  // A 298 desfaz o ×10 (o hóspede começa nas dezenas), uma vez só.
  const mig298 = fs.readFileSync(path.join(__dirname, "../src/databases/migrations/298_meu_mundo_atributos_inicio_baixo.sql"), "utf8");
  await pool.query(mig298);
  await pool.query(mig298);
  const low = await char();
  check("mig 298: ÷10 uma vez só, picos juntos e marca gravada", low.intelligence === 25 && low.strength === 30 && low.speed === 20 && low.attr_peaks?.strength === 30 && low.attr_peaks?.start_low === true, JSON.stringify([low.intelligence, low.strength, low.attr_peaks]));
  // Simular e gravar de novo não perde a marca (o serviço salva os picos inteiros).
  await Life.peek(host);
  check("a marca da 298 sobrevive ao salvar", (await char()).attr_peaks?.start_low === true);

  // ── Hospital ────────────────────────────────────────────────────────────────
  await pool.query(`UPDATE tb_mm_character SET health = 10 WHERE id_user = $1`, [host]);
  const hosp = await Life.get(host);
  check("saúde 10 → internado", hosp.character.status === "hospital" && hosp.events.some((e) => e.kind === "hospital_in"));
  check("internado não come nem estuda (409)", (await Life.consume(host, "pizza")).code === "hospital" && (await Life.setActivity(host, "studying", 2)).code === "hospital");

  // ── Morte e novo hóspede ────────────────────────────────────────────────────
  await pool.query(`UPDATE tb_mm_character SET activity = 'idle', health = 30, toxicity = 400, sim_at = sim_at - interval '3 hours' WHERE id_user = $1`, [host]);
  const dead = await Life.get(host);
  check("overdose → morto, com a causa", dead.character.status === "dead" && dead.character.deathCause === "overdose", JSON.stringify(dead.character.deathCause));
  check("morto não come, não estuda", (await Life.consume(host, "pizza")).code === "dead" && (await Life.setActivity(host, "studying", 1)).code === "dead");
  const wallet0 = (await Life.peek(host)).wallet.coins;
  const nc = await Life.newcomer(host);
  check("novo hóspede: geração 2, vivo, carteira mantida", nc.character.generation === 2 && nc.character.status === "alive" && nc.wallet.coins === wallet0);
  check("novo hóspede de novo: 409 (o atual está vivo)", (await Life.newcomer(host)).statusCode === 409);
  const gens = (await pool.query(`SELECT generation, status, death_seen_at FROM tb_mm_character WHERE id_user = $1 ORDER BY generation`, [host])).rows;
  check("o falecido fica no histórico, com a morte vista", gens.length === 2 && gens[0].status === "dead" && !!gens[0].death_seen_at && gens[1].status === "alive");
  let dup = false;
  try {
    await pool.query(`UPDATE tb_mm_character SET status = 'alive', died_at = NULL WHERE id_user = $1 AND generation = 1`, [host]);
  } catch {
    dup = true;
  }
  check("o banco recusa dois hóspedes vivos", dup);

  // ── Sala da casa: deitar, dormir, levantar ─────────────────────────────────
  const server = http.createServer(express());
  await new Promise((r) => server.listen(0, r));
  realtime.init(server);
  const { Client } = await import("@colyseus/sdk");
  const client = new Client(`ws://127.0.0.1:${server.address().port}/mm-ws`);
  let room = null;
  const box = [];
  const hook = (r) => {
    room = r;
    for (const t of ["bed", "stood", "welcome", "life", "seat"]) r.onMessage(t, (m) => box.push({ t, m }));
    r.onLeave(() => (r.__closed = true));
  };
  const join = async (out) => {
    if (room && !room.__closed) await Promise.race([room.leave().catch(() => {}), sleep(500)]);
    hook(await client.consumeSeatReservation(out.multiplayer.reservation));
    await sleep(150);
  };
  const got = (t) => box.filter((x) => x.t === t);
  const lot = res.lot_number;

  await join(await Service.enter(host));
  const street = realtime._roomFor(res.id_neighborhood);
  const door = (() => {
    const def = L.levelDef(1);
    const d = def.door ?? def.origin;
    return L.lotToWorld(L.LOTS[lot - 1], d.x, def.origin.z - 0.6);
  })();
  for (const s of street.sim.values()) if (s.userId === host) Object.assign(s.body, { x: door.x, z: door.z, vx: 0, vz: 0 });
  await sleep(120);
  const inHouse = await Service.enterHouse(host, lot);
  check("payload da casa traz as camas e a vida", inHouse.interior?.beds?.length >= 1 && inHouse.life?.character?.generation === 2);
  await join(inHouse);
  const H = () => {
    const r = realtime._houseRoomFor(res.id_house);
    for (const [sid, s] of r.sim) if (s.userId === host) return { r, s, p: r.state.players.get(sid) };
    return null;
  };
  const bed = interiorFor(1).beds[0];
  Object.assign(H().s.body, { x: 1.7, z: 3.5 }); // banheiro: longe da cama
  room.send("bed", { bed: bed.id, a: "lie" });
  await until(() => got("bed").length);
  check("deitar longe da cama é recusado", got("bed")[0]?.m.ok === false && got("bed")[0].m.reason === "far");
  Object.assign(H().s.body, { x: bed.stand.x, z: bed.stand.z });
  room.send("bed", { bed: bed.id, a: "lie" });
  await until(() => got("bed").length >= 2);
  check("deitar perto: confirmado, move 4, na cama", got("bed")[1]?.m.ok === true && H().p.move === 4 && H().p.bed === bed.id && H().p.x === bed.x);
  check("banco: deitado, com a cama", (await char()).activity === "lying" && (await char()).activity_bed?.bedId === bed.id);
  room.send("bed", { a: "sleep", hours: 8 });
  await until(() => got("bed").length >= 3);
  check("dormir 8 h: move 5 e banco 'sleeping'", got("bed")[2]?.m.ok === true && H().p.move === 5 && (await char()).activity === "sleeping");
  room.send("in", { x: 1, z: 0 });
  await sleep(300);
  check("dormindo não anda", H().p.x === bed.x && H().p.z === bed.z);

  // Sai do jogo dormindo e volta: entra na casa, já na cama.
  await Promise.race([room.leave().catch(() => {}), sleep(500)]);
  await sleep(200);
  box.length = 0;
  presence._reset(); // a volta é "depois de muito tempo": sem lembrança da sala
  const again = await Service.enter(host);
  check("voltar com o hóspede dormindo entra na casa", again.scene === "house", again.scene);
  await join(again);
  await until(() => got("bed").some((x) => x.m.restored));
  check("…e ele continua na cama dormindo", H()?.p.move === 5 && H().p.bed === bed.id && got("bed").some((x) => x.m.restored));

  room.send("stand", {});
  await until(() => got("stood").length);
  await sleep(300);
  check("levantar: fora da cama, move 0, banco à toa", got("stood").length === 1 && H().p.move === 0 && H().p.bed === "" && (await char()).activity === "idle");

  // Estimulante: não consegue dormir — quem estava em pé continua em pé.
  await Life.consume(host, "estimulante");
  box.length = 0;
  room.send("bed", { bed: bed.id, a: "sleep", hours: 8 });
  await until(() => got("bed").length);
  check("com estimulante, dormir é recusado e ele não fica na cama", got("bed")[0]?.m.reason === "stimulated" && H().p.bed === "", JSON.stringify(got("bed")[0]?.m));

  // Ritmo: exausto anda devagar (a sala recebe da vida).
  await pool.query(`UPDATE tb_mm_character SET energy = 5 WHERE id_user = $1 AND status = 'alive'`, [host]);
  await Life.peek(host);
  await sleep(150);
  check("energia 5 → ritmo exausto na sala", Math.abs(H().p.pace - PACE.EXHAUSTED) < 1e-6, String(H().p.pace));
  check("o cliente recebe o aviso de vida", got("life").some((x) => Math.abs(x.m.pace - PACE.EXHAUSTED) < 1e-6));

  // ── Vestuário (mig 300): condição física ≠ skin ─────────────────────────────
  const cond = (await Life.peek(host)).character.body.bodyHint;
  const w0 = await Life.skins(host);
  const sk = (w, id) => w.wardrobe.skins.find((x) => x.id === id);
  check("skins: padrão vestido e seu, Sergio à venda", sk(w0, "standard").equipped && sk(w0, "standard").owned && !sk(w0, "sergio").owned && sk(w0, "sergio").price > 0);
  check("skins: a condição vem junto", w0.wardrobe.condition === cond);
  check("vestir skin que não é sua: 409", (await Life.equipSkin(host, "sergio")).code === "notOwned");
  check("skin inexistente: 404", (await Life.buySkin(host, "nada")).statusCode === 404 && (await Life.equipSkin(host, "nada")).statusCode === 404);
  check("o padrão não se compra", (await Life.buySkin(host, "standard")).statusCode === 404);
  check("admin: Sergio custa 0 para ele", w0.wardrobe.admin === true && sk(w0, "sergio").cost === 0);
  // Admin adquire de graça (outro admin, para o caminho pago seguir com o anfitrião).
  const adm = await mkUser(pool, "adm");
  await Life.peek(adm);
  await pool.query(`UPDATE tb_mm_wallet SET coins = 3 WHERE id_user = $1`, [adm]);
  const free = await Life.buySkin(adm, "sergio");
  const admCoins = Number((await pool.query(`SELECT coins FROM tb_mm_wallet WHERE id_user = $1`, [adm])).rows[0].coins);
  const paid = (await pool.query(`SELECT price FROM tb_mm_skin_owned WHERE id_user = $1`, [adm])).rows[0]?.price;
  check("admin adquire de graça: é dele, carteira intacta, pago 0", free.bought === true && sk(free, "sergio").owned && Math.floor(admCoins) === 3 && paid === 0, JSON.stringify([free.error, admCoins, paid]));
  // Quem não é admin paga: o anfitrião perde o papel durante o caminho pago.
  await pool.query(`UPDATE tb_user_role SET is_active = FALSE WHERE id_user = $1`, [host]);
  check("sem papel: Sergio custa o preço", sk(await Life.skins(host), "sergio").cost === sk(w0, "sergio").price);
  await pool.query(`UPDATE tb_mm_wallet SET coins = 10 WHERE id_user = $1`, [host]);
  const poor = await Life.buySkin(host, "sergio");
  check("sem moedas: 402 e nada muda", poor.statusCode === 402 && (await coins()) === 10 && !(await Life.skins(host)).wardrobe.skins.find((x) => x.id === "sergio").owned);
  await pool.query(`UPDATE tb_mm_wallet SET coins = 5000 WHERE id_user = $1`, [host]);
  const price = sk(w0, "sergio").price;
  const [b1, b2] = await Promise.all([Life.buySkin(host, "sergio"), Life.buySkin(host, "sergio")]);
  check("duas compras simultâneas cobram UMA vez", [b1, b2].filter((b) => b.bought).length === 1 && Math.floor(await coins()) === 5000 - price, String(await coins()));
  await pool.query(`UPDATE tb_user_role SET is_active = TRUE WHERE id_user = $1`, [host]);
  check("comprar não veste", sk(b2, "sergio").owned && !sk(b2, "sergio").equipped && sk(b2, "standard").equipped);
  box.length = 0;
  const eq = await Life.equipSkin(host, "sergio");
  await sleep(150);
  check("vestir: sala desenha o Sergio e o cliente é avisado", eq.avatar === "sergio" && H().p.body === "sergio" && got("life").some((x) => x.m.body === "sergio"));
  check("vestido: a condição continua a do corpo", eq.character.body.bodyHint === cond && (await Storage.getBody(pool, host)) === "sergio");
  await Life.peek(host);
  await sleep(100);
  check("ler a vida não tira a skin", H().p.body === "sergio");
  const back2 = await Life.equipSkin(host, "standard");
  await sleep(150);
  check("tirar a skin: volta a condição", back2.avatar === cond && H().p.body === cond);

  await Promise.race([room.leave().catch(() => {}), sleep(500)]);
  console.log(`\n${PASS} ok, ${FAIL} falha(s)`);
  server.close();
  await pool.end().catch(() => {});
  process.exit(FAIL ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
