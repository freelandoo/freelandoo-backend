// test/meu-mundo-treinador.e2e.js — lore v2 F2: nível do TREINADOR (mig 437).
//
// O treinador é a conta: ganha o XP inteiro da missão e uma fração de luta/minijogo
// (com teto do dia) e de cuidar/treinar; tudo por recibo, dentro do withLife; não
// zera quando o personagem muda.
//
// Roda: TEST_DATABASE_URL=postgres://postgres:<senha>@127.0.0.1:55432/freelandoo_test npm run test:meu-mundo-treinador
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
  await pool.query(`DROP TABLE IF EXISTS tb_mm_trainer, tb_mm_refine_proposal, tb_mm_gear_unlock, tb_mm_quest, tb_mm_equip, tb_mm_gear, tb_mm_fight, tb_mm_receipt, tb_mm_char_adventure, tb_mm_adventure, tb_mm_artifact, tb_mm_clan,
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
  for (const f of all) {
    const sql = fs.readFileSync(path.join(__dirname, "../src/databases/migrations", f), "utf8");
    await pool.query(sql);
    if (f >= "437") await pool.query(sql); // a nova é idempotente
  }
}

/** Joga uma luta como o aparelho e fecha (relógio do ticket recuado para valer). */
async function playFight(pool, Adv, F, id, body) {
  const start = await Adv.fightStart(id, body);
  if (!start.fight) return start;
  const fight = new F.Fight({ ...start.fight.setup, style: start.fight.setup.style || undefined });
  const frames = [];
  for (let i = 0; i < 20000 && !fight.over; i++) {
    const q = F.quantizeInput({ mx: Math.sin(i / 45) * 0.5, mz: 0.85, run: false, attack: i % 17 === 0, dodge: false });
    F.pushFrame(frames, q);
    fight.step(q);
  }
  await pool.query(`UPDATE tb_mm_fight SET started_at = NOW() - INTERVAL '5 minutes' WHERE id_fight = $1`, [start.fight.ticket]);
  return Adv.fightFinish(id, { ticket: start.fight.ticket, frames });
}

const trainerRow = async (pool, id) => (await pool.query(`SELECT xp, level, gain_today, to_char(gain_day, 'YYYY-MM-DD') AS gain_day FROM tb_mm_trainer WHERE id_user = $1`, [id])).rows[0];
const receiptSum = async (pool, id) =>
  Number((await pool.query(`SELECT COALESCE(SUM((deltas->'trainer'->>'xp')::int), 0) AS n FROM tb_mm_receipt WHERE id_user = $1`, [id])).rows[0].n);

async function main() {
  const pool = require("../src/databases");
  await bootstrap(pool);
  const Life = require("../src/services/MeuMundoLifeService");
  Life.adminPerks = false;
  const Adv = require("../src/services/MeuMundoAdventureService");
  const Quest = require("../src/services/MeuMundoQuestService");
  const Trainer = require("../src/services/MeuMundoTrainerService");
  const T = require("../src/utils/meuMundoTrainer");
  const LifeU = require("../src/utils/meuMundoLife");
  const F = require("../src/utils/meuMundoFight");

  const id = crypto.randomUUID();
  await pool.query(`INSERT INTO tb_user VALUES ($1, 'mmt', 'mmt@mm.test')`, [id]);
  await pool.query(`INSERT INTO tb_mm_clan (id_user, clan, sex) VALUES ($1, 'vampiro', 'm')`, [id]);

  // ── conta nova: nível 1 ──
  const g0 = await Adv.get(id);
  check("conta nova: treinador nível 1 com 0 XP", g0.trainer && g0.trainer.level === 1 && g0.trainer.total === 0 && g0.trainer.need === T.xpForLevel(2), JSON.stringify(g0.trainer));
  check("conta nova: os dois níveis no GET /adventure", g0.adventure.level === 1 && g0.trainer.level === 1);

  // ── missão: XP inteiro ──
  const r1 = await Quest.advance(id, { action: "ack" });
  const step0 = require("../src/utils/meuMundoQuests").PROLOGUE.steps[0];
  check("missão: o treinador leva o XP do passo inteiro", r1.receipt && r1.receipt.deltas.trainer && r1.receipt.deltas.trainer.xp === step0.xp, JSON.stringify(r1.receipt && r1.receipt.deltas));
  check("missão: o personagem também ganha o XP (nível de aventura próprio)", r1.receipt.deltas.xp.xp === step0.xp);

  // ── luta: fração com teto ──
  const f1 = await playFight(pool, Adv, F, id, { origin: "laminas", kind: "cavaleiro", level: 1 });
  check("luta: recibo conferido", f1.receipt, JSON.stringify(f1.error || f1.code));
  const fx = f1.receipt.deltas.xp.xp;
  check("luta: treinador leva 25% do XP da luta", (f1.receipt.deltas.trainer ? f1.receipt.deltas.trainer.xp : 0) === Math.min(T.shareOf("fight", fx), T.GAIN.dailyCap), JSON.stringify([fx, f1.receipt.deltas.trainer]));
  const again = await Adv.fightFinish(id, { ticket: f1.receipt.actionKey, frames: [] });
  const sumA = await receiptSum(pool, id);
  check("luta: reenvio é o mesmo recibo e não soma de novo", again.replay === true && Number((await trainerRow(pool, id)).xp) === sumA, JSON.stringify([again.replay, sumA]));

  // ── minijogo: fração (100% do XP do jogo) ──
  const now = Date.now();
  const m1 = await Adv.creditMinigame(id, { activity: "jetpack", actionKey: "jetpack:t1:1", segments: [{ from: now - 9 * 60000, to: now - 60000 }], win: true });
  check("minijogo: treinador leva o XP do jogo", m1.receipt && m1.receipt.deltas.trainer && m1.receipt.deltas.trainer.xp === Math.min(m1.receipt.deltas.xp.xp, T.GAIN.dailyCap), JSON.stringify(m1.receipt && m1.receipt.deltas));

  // ── teto do dia ──
  const today = LifeU.localParts(Date.now()).day;
  await pool.query(`UPDATE tb_mm_trainer SET gain_day = $2, gain_today = $3 WHERE id_user = $1`, [id, today, T.GAIN.dailyCap - 2]);
  const f2 = await playFight(pool, Adv, F, id, { origin: "laminas", kind: "wolf", level: 1 });
  const tx2 = f2.receipt && f2.receipt.deltas.trainer ? f2.receipt.deltas.trainer.xp : 0;
  check("teto: perto do teto, a luta só completa o que falta", f2.receipt && tx2 <= 2, JSON.stringify([tx2, f2.error]));
  check("teto: gain_today não passa do teto", Number((await trainerRow(pool, id)).gain_today) <= T.GAIN.dailyCap);
  const r2 = await Quest.advance(id, { action: "ack" }).catch((e) => ({ error: e.message }));
  // o passo 2 do prólogo pede comer: come e entrega
  if (r2.code === "pending") {
    await Life.consume(id, "agua_coco");
  }
  const r2b = r2.receipt ? r2 : await Quest.advance(id, { action: "ack" });
  const step1 = require("../src/utils/meuMundoQuests").PROLOGUE.steps[1];
  check("teto: missão passa por cima do teto (XP inteiro)", r2b.receipt && r2b.receipt.deltas.trainer && r2b.receipt.deltas.trainer.xp === step1.xp, JSON.stringify(r2b.error || (r2b.receipt && r2b.receipt.deltas)));
  // o teto vira no dia seguinte
  await pool.query(`UPDATE tb_mm_trainer SET gain_day = (gain_day - 1) WHERE id_user = $1`, [id]);
  const f3 = await playFight(pool, Adv, F, id, { origin: "laminas", kind: "cavaleiro", level: 1 });
  check("teto: dia novo abre o teto de novo", f3.receipt && f3.receipt.deltas.trainer && f3.receipt.deltas.trainer.xp === T.shareOf("fight", f3.receipt.deltas.xp.xp), JSON.stringify(f3.receipt && f3.receipt.deltas));

  // ── cuidar e treinar (pelo diário da vida) ──
  const cu = crypto.randomUUID();
  await pool.query(`INSERT INTO tb_user VALUES ($1, 'mmc', 'mmc@mm.test')`, [cu]);
  await Life.peek(cu);
  const ch = (await pool.query(`SELECT id_character FROM tb_mm_character WHERE id_user = $1`, [cu])).rows[0].id_character;
  const D1 = "2026-11-10";
  const D2 = "2026-11-11";
  const day = (d, training, studying, meals) => ({ day: d, hours: { training, studying }, mealsEaten: meals });
  const at = new Date(`${D1}T15:00:00-03:00`).getTime();
  await pool.query(`DELETE FROM tb_mm_trainer WHERE id_user = $1`, [cu]);
  await pool.query(`DELETE FROM tb_mm_receipt WHERE id_user = $1 AND source = 'trainer'`, [cu]);
  const c1 = await Trainer.fromLife(pool, cu, ch, [day(D1, 2.5, 1.2, 2)], at);
  check("cuidar/treinar: 2 refeições + 3 horas úteis = 25 XP", c1 && c1.deltas.trainer.xp === 2 * T.GAIN.carePerMeal + 3 * T.GAIN.trainPerHour, JSON.stringify(c1 && c1.deltas));
  const c2 = await Trainer.fromLife(pool, cu, ch, [day(D1, 2.5, 1.2, 2)], at);
  check("cuidar/treinar: o mesmo diário não conta duas vezes", c2 === null);
  const c3 = await Trainer.fromLife(pool, cu, ch, [day(D1, 7, 1.2, 5)], at);
  check("cuidar/treinar: só o que é novo e dentro do limite (4 h de treino, 3 refeições)", c3 && c3.deltas.trainer.xp === 1 * T.GAIN.carePerMeal + 2 * T.GAIN.trainPerHour, JSON.stringify(c3 && c3.deltas));
  const atD2 = new Date(`${D2}T09:00:00-03:00`).getTime();
  const c4 = await Trainer.fromLife(pool, cu, ch, [day(D1, 7, 1.2, 5), day(D2, 1, 0, 1)], atD2);
  check("cuidar/treinar: dia novo zera os contadores; dia velho não volta", c4 && c4.deltas.trainer.xp === T.GAIN.carePerMeal + T.GAIN.trainPerHour, JSON.stringify(c4 && c4.deltas));
  const rows = Number((await pool.query(`SELECT COUNT(*) AS n FROM tb_mm_receipt WHERE id_user = $1 AND source = 'trainer'`, [cu])).rows[0].n);
  check("cuidar/treinar: um recibo por crédito", rows === 3, String(rows));
  check("cuidar/treinar: XP do treinador = soma dos recibos", Number((await trainerRow(pool, cu)).xp) === (await receiptSum(pool, cu)));

  // ── trocar de personagem não zera o treinador ──
  const before = await Adv.get(id);
  await pool.query(`UPDATE tb_mm_character SET status = 'capsule' WHERE id_user = $1 AND status = 'alive'`, [id]);
  await pool.query(`INSERT INTO tb_mm_char_adventure (id_character, id_user) SELECT id_character, id_user FROM tb_mm_character WHERE id_user = $1 ON CONFLICT DO NOTHING`, [id]);
  const after = await Adv.get(id);
  check("troca de personagem: aventura volta ao nível 1, o treinador fica", after.adventure.total === 0 && after.trainer.total === before.trainer.total && before.trainer.total > 0, JSON.stringify([before.trainer, after.adventure, after.trainer]));
  check("XP do treinador = soma de todos os recibos da conta", Number((await trainerRow(pool, id)).xp) === (await receiptSum(pool, id)));

  // ── subir de nível ──
  const big = await pool.connect();
  try {
    await big.query("BEGIN");
    const d = await Trainer.grant(big, cu, "quest", T.xpForLevel(3), Date.now());
    await big.query("COMMIT");
    check("subida: o delta diz de/para e o que falta", d && d.to >= 3 && d.from === 1 && d.need === T.xpForLevel(d.to + 1) - T.xpForLevel(d.to), JSON.stringify(d));
  } finally {
    big.release();
  }

  console.log(`\n${PASS} ok, ${FAIL} falhas`);
  await pool.end();
  process.exit(FAIL ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
