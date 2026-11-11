// test/meu-mundo-predios.e2e.js — lore v2 F6: prédios por nível do treinador.
//
// O SERVIDOR recusa a rota do prédio fechado (interior, atividade no lugar,
// minijogo, luta no Boxe/Arena, Hall, Forja, Laboratório completo) com o nível
// que falta; administrador passa (MM_ADMIN_LOCKS=1 desliga a passagem); conta
// nova e conta antiga entram em casa, comida e Laboratório; e a missão de cada
// prédio abre com ele e é entregue com recibo único.
//
// Roda: TEST_DATABASE_URL=postgres://postgres:<senha>@127.0.0.1:55432/freelandoo_test npm run test:meu-mundo-predios
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

/** Resposta falsa do Express: guarda status e corpo. */
function fakeRes() {
  const out = { status: 200, body: null };
  const res = {
    set() {
      return res;
    },
    status(n) {
      out.status = n;
      return res;
    },
    json(b) {
      out.body = b;
      return res;
    },
  };
  return { res, out };
}

async function main() {
  const pool = require("../src/databases");
  await bootstrap(pool);
  const Life = require("../src/services/MeuMundoLifeService");
  Life.adminPerks = false;
  const Bld = require("../src/services/MeuMundoBuildingService");
  const Ctl = require("../src/controllers/MeuMundoController");
  const AdvStore = require("../src/storages/MeuMundoAdventureStorage");
  const Trainer = require("../src/utils/meuMundoTrainer");
  const Quest = require("../src/services/MeuMundoQuestService");

  const user = async (name) => {
    const id = crypto.randomUUID();
    await pool.query(`INSERT INTO tb_user VALUES ($1, $2, $3)`, [id, name, `${name}@mm.test`]);
    await Life.peek(id);
    return id;
  };
  const setLevel = (id, L) =>
    pool.query(`INSERT INTO tb_mm_trainer (id_user, xp, level) VALUES ($1, $2, $3) ON CONFLICT (id_user) DO UPDATE SET xp = EXCLUDED.xp, level = EXCLUDED.level`, [id, Trainer.xpForLevel(L), L]);
  const call = async (fn, id, { params = {}, body = {} } = {}) => {
    const { res, out } = fakeRes();
    await Ctl[fn]({ user: { id_user: id }, params, body }, res);
    return out;
  };

  // ── conta nova: nível 1 ──
  const nu = await user("mmp_novo");
  check("conta nova está no nível 1 do treinador", (await Bld.state(nu)).trainer === 1);
  for (const p of ["criolab", "supermercado", "pizzaria", "hamburgueria", "academia", "hospital", "delegacia"]) check(`nível 1: ${p} aberto`, (await Bld.gate(nu, p)) === null);
  let g = await Bld.gate(nu, "jetpack");
  check("nível 1: minijogo fechado, abre no 5", g && g.code === "closed" && g.level === 5 && g.statusCode === 403, JSON.stringify(g));
  check("nível 1: Arena/Hall fechado, abre no 10", (await Bld.gate(nu, "laminas")).level === 10);
  check("nível 1: universidade abre no 8", (await Bld.gate(nu, "universidade")).level === 8);
  check("nível 1: Laboratório completo fechado (10)", (await Bld.gateFeature(nu, "lab_full")).level === 10);

  // rotas: o servidor recusa
  let r = await call("centerInterior", nu, { params: { id: "universidade" } });
  check("GET interior da universidade no nível 1 → 403 com o nível", r.status === 403 && r.body.code === "closed" && r.body.level === 8, JSON.stringify(r));
  r = await call("centerInterior", nu, { params: { id: "criolab" } });
  check("GET interior do Laboratório no nível 1 → abre", r.status === 200 && r.body.id === "criolab");
  r = await call("centerInterior", nu, { params: { id: "supermercado" } });
  check("GET interior do supermercado no nível 1 → abre", r.status === 200);
  r = await call("jetpackJoin", nu);
  check("entrar no Jetpack no nível 1 → 403", r.status === 403 && r.body.level === 5);
  for (const fn of ["paintJoin", "corridaJoin", "noturnoJoin", "gincanaJoin"]) check(`${fn} no nível 1 → 403`, (await call(fn, nu)).status === 403);
  r = await call("fightStart", nu, { body: { origin: "boxe", kind: "brute" } });
  check("luta no ringue do Boxe no nível 1 → 403 (abre no 11)", r.status === 403 && r.body.level === 11);
  check("nível 1: Gincana abre no 3 e Paint por último, no 13", (await Bld.gate(nu, "gincana")).level === 3 && (await Bld.gate(nu, "paint")).level === 13);
  r = await call("fightStart", nu, { body: { origin: "laminas", kind: "stone" } });
  check("luta na Arena no nível 1 → 403 (10)", r.status === 403 && r.body.level === 10);
  r = await call("fightStart", nu, { body: { origin: "tutorial" } });
  check("luta de treino não é prédio: não leva a trava", r.body?.code !== "closed");
  check("Hall (quadro) no nível 1 → 403", (await call("hallBoard", nu)).status === 403);
  check("Forja no nível 1 → 403", (await call("gearForge", nu, { body: { recipe: "x" } })).status === 403);
  check("embrião no nível 1 → 403", (await call("characterEmbryo", nu, { body: {} })).status === 403);
  check("acelerador no nível 1 → 403", (await call("characterAccelerate", nu, { params: { id: crypto.randomUUID() } })).status === 403);
  r = await call("lifeActivity", nu, { body: { activity: "studying", hours: 1, place: "universidade" } });
  check("estudar na universidade no nível 1 → 403", r.status === 403 && r.body.level === 8);
  r = await call("lifeActivity", nu, { body: { activity: "training", hours: 1, place: "academia" } });
  check("treinar na academia no nível 1 não leva a trava", r.body?.code !== "closed", JSON.stringify(r.body && r.body.error));
  const st = await Bld.state(nu);
  check("missões de prédio: todas trancadas no nível 1", st.missions.every((m) => m.state === "locked"));

  // ── nível 3 e 5: um minijogo a cada 2 níveis ──
  await setLevel(nu, 3);
  check("nível 3: só a Gincana abre", (await Bld.gate(nu, "gincana")) === null && (await Bld.gate(nu, "jetpack")).level === 5);
  await setLevel(nu, 5);
  check("nível 5: Gincana e Jetpack; Boxe e Paint seguem fechados", (await Bld.gate(nu, "jetpack")) === null && (await Bld.gate(nu, "boxe")).level === 11 && (await Bld.gate(nu, "paint")).level === 13);
  check("nível 5: universidade ainda fecha", (await Bld.gate(nu, "universidade")).level === 8);
  r = await call("jetpackJoin", nu);
  check("entrar no Jetpack no nível 5 passa da trava", r.body?.code !== "closed");
  let s5 = await Bld.state(nu);
  let m = s5.missions.find((x) => x.id === "pr_jetpack");
  check("nível 5: missão do Jetpack abre (e a da Gincana também)", m.state === "current" && !m.ready && s5.missions.find((x) => x.id === "pr_gincana").state === "current", JSON.stringify(m));
  check("…a do Paint não", s5.missions.find((x) => x.id === "pr_paint").state === "locked");
  check("…e as do nível 8 seguem trancadas", s5.missions.find((x) => x.id === "pr_forja").state === "locked");
  check("missão sem cumprir → 'pending'", (await Bld.deliver(nu, { id: "pr_jetpack" })).code === "pending");
  check("missão de nível acima → 'missionLocked'", (await Bld.deliver(nu, { id: "pr_hall" })).code === "missionLocked");
  check("missão desconhecida → 'mission'", (await Bld.deliver(nu, { id: "pr_zz" })).code === "mission");
  const ch = (await pool.query(`SELECT id_character FROM tb_mm_character WHERE id_user = $1`, [nu])).rows[0].id_character;
  await new Promise((res) => setTimeout(res, 2100));
  await AdvStore.insertReceipt(pool, { idUser: nu, idCharacter: ch, source: "minigame:jetpack", actionKey: "k1", rules: "R3", result: { activity: "jetpack" }, deltas: {}, items: [] });
  s5 = await Bld.state(nu);
  check("jogou o Jetpack → missão pronta", s5.missions.find((x) => x.id === "pr_jetpack").ready);
  check("…e não cumpre a da Gincana", !s5.missions.find((x) => x.id === "pr_gincana").ready);
  const tBefore = Number((await pool.query(`SELECT xp FROM tb_mm_trainer WHERE id_user = $1`, [nu])).rows[0].xp);
  const d1 = await Bld.deliver(nu, { id: "pr_jetpack" });
  const tAfter = Number((await pool.query(`SELECT xp FROM tb_mm_trainer WHERE id_user = $1`, [nu])).rows[0].xp);
  check("missão de prédio vale 30 XP do treinador (sem teto do dia)", tAfter - tBefore === 30, `${tBefore} → ${tAfter}`);
  check("…e o recibo traz os 30 XP do personagem", d1.receipt && d1.receipt.deltas && d1.receipt.deltas.xp && d1.receipt.deltas.xp.xp === 30, JSON.stringify(d1.receipt && d1.receipt.deltas));
  check("entrega com recibo único", !!d1.receipt && d1.replay === false && d1.receipt.actionKey === "pr:pr_jetpack", JSON.stringify(d1.error || d1.receipt && d1.receipt.actionKey));
  const d2 = await Bld.deliver(nu, { id: "pr_jetpack" });
  check("reenvio devolve o MESMO recibo (sem prêmio de novo)", d2.replay === true && d2.receipt.eventId === d1.receipt.eventId);
  check("missão fica feita", (await Bld.state(nu)).missions.find((x) => x.id === "pr_jetpack").state === "done");
  // o capítulo não apaga as missões de prédio
  await Quest.get(nu);
  check("ler o capítulo não apaga a missão de prédio", (await pool.query(`SELECT 1 FROM tb_mm_quest WHERE id_user = $1 AND quest_id = 'pr_jetpack'`, [nu])).rows.length === 1);
  check("e a missão de prédio não vira 'acompanhada' (o card é do capítulo)", (await pool.query(`SELECT tracked FROM tb_mm_quest WHERE id_user = $1 AND quest_id = 'pr_jetpack'`, [nu])).rows[0].tracked === false);

  // ── nível 10 ──
  await setLevel(nu, 10);
  check("nível 10: Arena/Hall e Laboratório completo abrem", (await Bld.gate(nu, "laminas")) === null && (await Bld.gateFeature(nu, "lab_full")) === null);
  check("nível 10: Boxe e Paint ainda fechados", (await Bld.gate(nu, "boxe")).level === 11 && (await Bld.gate(nu, "paint")).level === 13);
  await setLevel(nu, 13);
  check("nível 13: o Paint abre por último e todas as missões estão abertas", (await Bld.gate(nu, "paint")) === null && (await Bld.state(nu)).missions.every((x) => x.state !== "locked"));

  // ── conta antiga (já jogou: capítulo e prólogo antigo) ──
  const old = await user("mmp_antigo");
  await pool.query(`INSERT INTO tb_mm_quest (id_user, quest_id, step, done_at, tracked) VALUES ($1, 'despertar', 9, NOW(), FALSE)`, [old]);
  await Quest.get(old);
  check("conta antiga: prólogo antigo sai, capítulo 1 abre", (await pool.query(`SELECT quest_id FROM tb_mm_quest WHERE id_user = $1 ORDER BY quest_id`, [old])).rows.map((x) => x.quest_id).join() === "cap1");
  check("conta antiga recomeça no nível 1", (await Bld.state(old)).trainer === 1);
  for (const p of ["criolab", "supermercado", "pizzaria", "hamburgueria", "academia"]) check(`conta antiga: ${p} aberto`, (await Bld.gate(old, p)) === null);

  // ── administrador passa direto ──
  const adm = await user("mmp_admin");
  await pool.query(`INSERT INTO tb_user_role (id_user, id_role) SELECT $1, id_role FROM tb_role WHERE desc_role = 'Administrator'`, [adm]);
  check("admin no nível 1 entra na Arena", (await Bld.gate(adm, "laminas")) === null && (await Bld.gateFeature(adm, "lab_full")) === null);
  const sa = await Bld.state(adm);
  check("GET /buildings diz que o admin passa direto", sa.bypass === true && sa.trainer === 1);
  check("…mas as missões seguem o nível de verdade", sa.missions.every((x) => x.state === "locked"));
  process.env.MM_ADMIN_LOCKS = "1";
  check("MM_ADMIN_LOCKS=1: admin vê a trava (teste)", (await Bld.gate(adm, "laminas")).level === 10 && (await Bld.state(adm)).bypass === false);
  delete process.env.MM_ADMIN_LOCKS;

  console.log(`\n${PASS} ok, ${FAIL} falhas`);
  await pool.end();
  process.exit(FAIL ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
