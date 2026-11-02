// test/meu-mundo-aventura.e2e.js — MEU MUNDO 3D mm3d-59: luta conferida,
// recibos e XP no banco (mig 320), SEM o benefício de admin.
//
// Roda: TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55432/mm npm run test:meu-mundo-aventura
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
  await pool.query(`DROP TABLE IF EXISTS tb_mm_fight, tb_mm_receipt, tb_mm_adventure, tb_mm_artifact, tb_mm_clan,
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
    // chat (303) e salão (312) dependem de tabelas de fora do Meu Mundo
    .filter((f) => /^\d{3}_meu_mundo/.test(f) && Number(f.slice(0, 3)) >= 291 && !/^(303|312)_/.test(f))
    .sort();
  for (const f of all) {
    const sql = fs.readFileSync(path.join(__dirname, "../src/databases/migrations", f), "utf8");
    await pool.query(sql);
    if (f.startsWith("320")) await pool.query(sql); // a nova é idempotente
  }
}

async function main() {
  const pool = require("../src/databases");
  await bootstrap(pool);
  const Life = require("../src/services/MeuMundoLifeService");
  Life.adminPerks = false; // balanceamento é sem o benefício de admin
  const Adv = require("../src/services/MeuMundoAdventureService");
  const F = require("../src/utils/meuMundoFight");

  const id = crypto.randomUUID();
  await pool.query(`INSERT INTO tb_user VALUES ($1, 'mma', 'mma@mm.test')`, [id]);

  // conta "antiga": nasce, depois zera a destreza como se fosse de antes da mig 320
  await Life.peek(id);
  await pool.query(`UPDATE tb_mm_character SET dexterity = NULL WHERE id_user = $1`, [id]).catch(() => null);
  const seed = (await pool.query(`SELECT seed, dexterity FROM tb_mm_character WHERE id_user = $1`, [id])).rows[0];
  check("destreza gravada (NOT NULL, nascimento pela semente)", seed.dexterity === 15 + (Math.abs(seed.seed) % 16), JSON.stringify(seed));

  const start = await Adv.fightStart(id, { origin: "laminas", kind: "soldier", level: 1 });
  check("start devolve ticket e semente do servidor", start.fight && start.fight.ticket && start.fight.setup.seed > 0, JSON.stringify(start).slice(0, 200));
  const life0 = (await Life.peek(id)).character.vitals;

  // joga a luta como o aparelho (com a entrada quantizada)
  const setup = { ...start.fight.setup, style: start.fight.setup.style || undefined };
  const fight = new F.Fight(setup);
  const frames = [];
  for (let i = 0; i < 20000 && !fight.over; i++) {
    const q = F.quantizeInput({ mx: Math.sin(i / 45) * 0.5, mz: 0.85, run: false, attack: i % 17 === 0, dodge: false });
    F.pushFrame(frames, q);
    fight.step(q);
  }
  check("a luta de teste termina", !!fight.over);

  // relógio: a gravação não pode durar mais que o tempo real desde o start
  const early = await Adv.fightFinish(id, { ticket: start.fight.ticket, frames });
  check("fim cedo demais é recusado (clock)", early.code === "clock", JSON.stringify(early));
  await pool.query(`UPDATE tb_mm_fight SET started_at = NOW() - INTERVAL '2 minutes' WHERE id_fight = $1`, [start.fight.ticket]);

  // gravação falsa: o aparelho diz que venceu, mas não atacou
  const fake = await Adv.fightFinish(id, { ticket: start.fight.ticket, frames: [[200, 0, 127, 0]] });
  check("gravação sem fim não vale", fake.code === "replay", JSON.stringify(fake));

  // duas abas mandam o mesmo fim ao mesmo tempo
  const [a, b] = await Promise.all([
    Adv.fightFinish(id, { ticket: start.fight.ticket, frames }),
    Adv.fightFinish(id, { ticket: start.fight.ticket, frames }),
  ]);
  check("os dois recebem recibo", a.receipt && b.receipt, JSON.stringify([a.error, b.error]));
  check("mesmo eventId nas duas respostas", a.receipt && b.receipt && a.receipt.eventId === b.receipt.eventId);
  check("só um concedeu (o outro é replay)", [a.replay, b.replay].filter(Boolean).length === 1);
  const n = (await pool.query(`SELECT COUNT(*)::int AS n FROM tb_mm_receipt WHERE id_user = $1`, [id])).rows[0].n;
  check("um recibo no banco", n === 1, String(n));
  const rec = a.receipt;
  check("vitória decidida pelo servidor", rec.result.win === fight.over.win);
  const adv = (await pool.query(`SELECT xp FROM tb_mm_adventure WHERE id_user = $1`, [id])).rows[0];
  check("XP gravado uma vez", Number(adv.xp) === rec.deltas.xp.xp && rec.deltas.xp.xp > 0, JSON.stringify([adv, rec.deltas.xp]));
  check("força e destreza praticadas", rec.deltas.attrs.strength > 0 && rec.deltas.attrs.dexterity > 0, JSON.stringify(rec.deltas.attrs));
  check("custo de energia efetivo no recibo", rec.deltas.vitals.energy <= 0 && rec.deltas.vitals.energy >= -5, JSON.stringify(rec.deltas.vitals));
  const life1 = (await Life.peek(id)).character;
  check("snapshot mostra destreza e orçamento de hoje", life1.attributes.dexterity > 0 && life1.attributes.budgetToday.strength.used > 0, JSON.stringify(life1.attributes.budgetToday));
  check("energia caiu (vida passiva + luta)", life1.vitals.energy < life0.energy + 0.01);

  // reenvio depois (resposta perdida): mesmo recibo
  const again = await Adv.fightFinish(id, { ticket: start.fight.ticket, frames });
  check("reenvio devolve o mesmo recibo", again.replay === true && again.receipt.eventId === rec.eventId);

  // abandono: abre e não fecha; a próxima abre e cobra a derrota uma vez
  const s2 = await Adv.fightStart(id, { origin: "laminas", kind: "golem", level: 1 });
  const s3 = await Adv.fightStart(id, { origin: "laminas", kind: "golem", level: 1 });
  check("luta abandonada vira derrota (uma vez)", s3.abandoned.length === 1 && s3.abandoned[0].result.abandoned && s3.abandoned[0].actionKey === s2.fight.ticket);
  const s4 = await Adv.fightStart(id, { origin: "laminas", kind: "golem", level: 1 });
  check("o abandono não é cobrado de novo", s4.abandoned.length === 1 && s4.abandoned[0].actionKey === s3.fight.ticket);

  // monstro da rua sem a sala ter visto: recusa
  const mob = await Adv.fightStart(id, { origin: "mob", mobId: 7 });
  check("monstro que a sala não confirmou é recusado", mob.code === "mob");

  const get = await Adv.get(id);
  check("GET /adventure traz nível e recibos", get.adventure.level >= 1 && get.receipts.length >= 3);

  console.log(`\n${PASS} ok, ${FAIL} falhas`);
  await pool.end();
  process.exit(FAIL ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
