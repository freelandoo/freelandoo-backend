// test/meu-mundo-lugares.e2e.js — lore v2 F4: visit:<lugar> e talk:<npc>.
//
// A sala grava a visita FORA do laço (o tick volta na hora; o banco recebe
// depois); o check lê o evento; a conversa só vale com a última visita no lugar
// do NPC, há menos de 1 h; e o capítulo 1 anda até o fim com isso.
//
// Roda: TEST_DATABASE_URL=postgres://postgres:<senha>@127.0.0.1:55432/freelandoo_test npm run test:meu-mundo-lugares
// Só Postgres LOCAL e descartável (derruba e recria as tabelas do Meu Mundo).

const url = process.env.TEST_DATABASE_URL;
if (!url || !/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("TEST_DATABASE_URL precisa apontar para um Postgres LOCAL e descartável.");
  process.exit(2);
}
process.env.DATABASE_URL = url;
process.env.DATABASE_SSL = "false";

const fs = require("fs");
const path = require("path");
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

async function bootstrap(pool) {
  await pool.query(`DROP TABLE IF EXISTS tb_mm_video, tb_mm_archive, tb_mm_trainer, tb_mm_refine_proposal, tb_mm_gear_unlock, tb_mm_quest, tb_mm_equip, tb_mm_gear, tb_mm_fight, tb_mm_receipt, tb_mm_char_adventure, tb_mm_adventure, tb_mm_artifact, tb_mm_clan,
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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const pool = require("../src/databases");
  await bootstrap(pool);
  const Life = require("../src/services/MeuMundoLifeService");
  Life.adminPerks = false;
  const Quest = require("../src/services/MeuMundoQuestService");
  const PlaceSvc = require("../src/services/MeuMundoPlaceService");
  const Places = require("../src/utils/meuMundoPlaces");
  const Center = require("../src/utils/meuMundoCenter");
  const { CentroRoom, BairroRoom } = require("../src/realtime/meuMundo");

  const id = crypto.randomUUID();
  await pool.query(`INSERT INTO tb_user VALUES ($1, 'mml', 'mml@mm.test')`, [id]);
  await Life.peek(id);
  const ch = (await pool.query(`SELECT id_character FROM tb_mm_character WHERE id_user = $1`, [id])).rows[0].id_character;
  const past = new Date(Date.now() - 60000);
  const row = { step_at: past, started_at: past, data: {} };
  const sat = async (check) => Quest.satisfied(pool, id, ch, {}, { key: "x", check, xp: 1 }, row);
  const visits = async () => (await pool.query(`SELECT data->>'place' AS p FROM tb_mm_character_event WHERE id_character = $1 AND kind = 'visit' ORDER BY id_event`, [ch])).rows.map((r) => r.p);

  // ── a sala: confere e grava fora do laço ──
  const sent = [];
  const sim = new Map([["s1", { userId: id, body: { x: Center.PORTAL.x, z: 0 } }], ["bot", { body: { x: 0, z: 0 } }]]);
  const room = { sim, clients: [{ sessionId: "s1", send: (t, p) => sent.push([t, p]) }] };
  const tick = (now) => CentroRoom.prototype.tickVisits.call(Object.assign(room, { visitPoints: CentroRoom.prototype.visitPoints }), now);
  check("visit:portal sem passar = não", !(await sat("visit:portal")).ok);
  let t0 = Date.now();
  const t = Date.now();
  tick(t0);
  check("tick volta sem esperar o banco (< 5 ms)", Date.now() - t < 5, `${Date.now() - t} ms`);
  await wait(150);
  check("chegou no portal → evento visit", (await visits()).join() === "portal", (await visits()).join());
  check("a pessoa recebe 'visited' { p }", sent.length === 1 && sent[0][0] === "visited" && sent[0][1].p === "portal", JSON.stringify(sent));
  check("visit:portal pelo evento", (await sat("visit:portal")).ok);
  check("quem não tem userId (robô) não grava", (await pool.query(`SELECT COUNT(*)::int n FROM tb_mm_character_event WHERE kind='visit'`)).rows[0].n === 1);
  tick(t0 + 600);
  await wait(100);
  check("parado no portal meio segundo depois: não grava de novo", (await visits()).length === 1);
  // anda até Morkhan
  sim.get("s1").body = { x: 1, z: 6 };
  tick(t0 + 5000);
  await wait(150);
  check("Morkhan dentro da praça: grava o ponto menor", (await visits()).slice(-1)[0] === "estatua_morkhan");
  check("visit:estatua_morkhan", (await sat("visit:estatua_morkhan")).ok);
  check("visit:praca ainda não (só passou por Morkhan)", !(await sat("visit:praca")).ok);
  sim.get("s1").body = { x: -12, z: 0 };
  tick(t0 + 9000);
  await wait(150);
  check("visit:praca", (await sat("visit:praca")).ok);
  // parado: grava de novo depois de 1 min, sem avisar a pessoa de novo
  const nSent = sent.length;
  tick(t0 + 9000 + Places.VISIT_REPEAT_MS);
  await wait(150);
  check("parado 1 min: grava de novo (o passo pode abrir com a pessoa já lá)", (await visits()).filter((p) => p === "praca").length === 2);
  check("…sem mandar 'visited' repetido", sent.length === nSent);
  // preso não conta
  sim.get("s1").jailed = true;
  sim.get("s1").body = { x: Center.PORTAL.x, z: 0 };
  tick(t0 + 200000);
  await wait(100);
  check("preso não grava visita", (await visits()).slice(-1)[0] === "praca");
  sim.get("s1").jailed = false;
  check("bairro: Aurion é ponto da sala do bairro", BairroRoom.prototype.visitPoints().some((p) => p.id === "estatua_aurion"));
  check("visit:<lugar> estranho é recusado na gravação", (await PlaceSvc.recordVisit(id, "x'; drop")) === false);

  // ── conversa ──
  check("talk sem npc → recusa", (await Quest.mark(id, { mark: "talk" })).code === "npc");
  check("talk com npc desconhecido → recusa", (await Quest.mark(id, { mark: "talk", npc: "zephyra" })).code === "npc");
  let r = await Quest.mark(id, { mark: "talk", npc: "nivea" });
  check("talk:nivea longe do Laboratório (última visita = praça) → recusa 'far'", r.code === "far", JSON.stringify(r));
  check("talk:nivea não cumpre sem a conversa", !(await sat("talk:nivea")).ok);
  r = await Quest.mark(id, { mark: "talk", npc: "raposa_velha" });
  check("talk:raposa_velha na praça → ok", r.ok === true, JSON.stringify(r));
  check("talk:raposa_velha cumpre", (await sat("talk:raposa_velha")).ok);
  check("talk:vampiro_velho não cumpre com a conversa de outro", !(await sat("talk:vampiro_velho")).ok);
  await PlaceSvc.recordVisit(id, "criolab");
  r = await Quest.mark(id, { mark: "talk", npc: "nivea" });
  check("entrou no Laboratório (porta) → talk:nivea ok", r.ok === true, JSON.stringify(r));
  check("talk:nivea cumpre", (await sat("talk:nivea")).ok);
  r = await Quest.mark(id, { mark: "talk", npc: "raposa_velha" });
  check("dentro do Laboratório, o velho da praça → 'far'", r.code === "far");
  await pool.query(`UPDATE tb_mm_character_event SET at = NOW() - interval '61 minutes' WHERE id_character = $1 AND kind = 'visit'`, [ch]);
  r = await Quest.mark(id, { mark: "talk", npc: "nivea" });
  check("visita de mais de 1 h atrás não vale → 'far'", r.code === "far");
  await PlaceSvc.recordVisit(id, "delegacia");
  r = await Quest.mark(id, { mark: "talk", npc: "delegado" });
  check("talk:delegado na Delegacia", r.ok === true && (await sat("talk:delegado")).ok);

  // ── capítulo 1 inteiro, conta nova ──
  const nu = crypto.randomUUID();
  await pool.query(`INSERT INTO tb_user VALUES ($1, 'mmn', 'mmn@mm.test')`, [nu]);
  let q = await Quest.get(nu);
  check("conta nova começa no capítulo 1, passo 0", q.quest && q.quest.id === "cap1" && q.quest.step === 0, JSON.stringify(q.quest && q.quest.id));
  const adv = (body) => Quest.advance(nu, body);
  const step = async () => (await Quest.get(nu)).quest;
  await adv({});
  await pool.query(`INSERT INTO tb_mm_clan (id_user, clan, sex) VALUES ($1, 'raposa', 'f')`, [nu]);
  await adv({});
  const nch = (await pool.query(`SELECT id_character FROM tb_mm_character WHERE id_user = $1`, [nu])).rows[0].id_character;
  await wait(2100);
  await pool.query(`INSERT INTO tb_mm_character_event (id_character, at, kind, data) VALUES ($1, NOW(), 'consume', '{}')`, [nch]);
  await adv({});
  let cur = await step();
  check("cap. 1 chega ao passo 'praca' (antes da F4 parava aqui)", cur.current && cur.current.key === "praca" && cur.current.waiting === false, JSON.stringify(cur.current));
  check("praça ainda não visitada → entregar recusa", (await adv({})).code === "pending");
  await wait(2100);
  await PlaceSvc.recordVisit(nu, "praca");
  check("visitou a praça → entrega", !!(await adv({})).receipt);
  await wait(2100);
  await PlaceSvc.recordVisit(nu, "estatua_morkhan");
  check("chegou em Morkhan → entrega", !!(await adv({})).receipt);
  await wait(2100);
  check("Nívea sem voltar ao Laboratório → recusa", (await Quest.mark(nu, { mark: "talk", npc: "nivea" })).code === "far");
  await PlaceSvc.recordVisit(nu, "criolab");
  check("voltou ao Laboratório e falou com a Nívea", (await Quest.mark(nu, { mark: "talk", npc: "nivea" })).ok === true);
  const last = await adv({});
  check("capítulo 1 concluído", !!last.receipt && last.receipt.result && last.receipt.result.last === true, JSON.stringify(last.error || last.receipt && last.receipt.result));

  console.log(`\n${PASS} ok, ${FAIL} falhas`);
  await pool.end();
  process.exit(FAIL ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
