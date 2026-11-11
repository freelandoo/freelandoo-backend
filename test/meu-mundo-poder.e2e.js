// test/meu-mundo-poder.e2e.js — MEU MUNDO 3D B7 (migs 334/335): acurácia, PODER guardado pela vida e
// a aba Ranking (Poder, Nível, Freelandoo).
//
// Roda: TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55432/b7 npm run test:meu-mundo-poder
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
  await pool.query(`DROP TABLE IF EXISTS tb_mm_refine_proposal, tb_mm_gear_unlock, tb_mm_quest, tb_mm_equip, tb_mm_gear, tb_mm_fight, tb_mm_receipt, tb_mm_char_adventure, tb_mm_adventure, tb_mm_artifact, tb_mm_clan,
                    tb_mm_car_paint_owned, tb_mm_consume_key, tb_mm_pantry, tb_mm_skin_owned, tb_mm_character_event,
                    tb_mm_character_day, tb_mm_character, tb_mm_wallet, tb_mm_notice, tb_mm_mail,
                    tb_mm_visit, tb_mm_avatar_pref, tb_mm_residence, tb_mm_house, tb_mm_lot,
                    tb_mm_neighborhood, tb_profile, tb_user_role, tb_role, tb_user CASCADE`);
  await pool.query(`CREATE TABLE tb_user (id_user UUID PRIMARY KEY, username TEXT, email TEXT, is_minor BOOLEAN NOT NULL DEFAULT FALSE)`);
  await pool.query(`CREATE TABLE tb_profile (id_profile UUID PRIMARY KEY DEFAULT gen_random_uuid(), id_user UUID, display_name TEXT,
                    avatar_url TEXT, is_user_account BOOLEAN DEFAULT FALSE, deleted_at TIMESTAMPTZ NULL)`);
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
    if (f >= "335") await pool.query(sql); // a nova é idempotente
  }
}

async function main() {
  const pool = require("../src/databases");
  await bootstrap(pool);
  const Life = require("../src/services/MeuMundoLifeService");
  Life.adminPerks = false;
  const Poder = require("../src/services/MeuMundoPoderService");
  const { powerScore } = require("../src/utils/meuMundoPower");
  const FightSim = require("../src/utils/meuMundoFight");
  const powerOfRow = async (id) => (await pool.query(`SELECT id_character, power AS poder, status FROM tb_mm_character WHERE id_user = $1 AND status = 'alive'`, [id])).rows[0];
  const RankingStorage = require("../src/storages/RankingStorage");

  const mk = async (name, minor = false) => {
    const id = crypto.randomUUID();
    await pool.query(`INSERT INTO tb_user VALUES ($1, $2, $3, $4)`, [id, name, `${name}@mm.test`, minor]);
    await pool.query(`INSERT INTO tb_profile (id_user, display_name, is_user_account) VALUES ($1, $2, TRUE)`, [id, name.toUpperCase()]);
    return id;
  };
  const A = await mk("ana");
  const B = await mk("bia");
  const K = await mk("kid", true);

  // ── acurácia: coluna nova, nasce em 0, sai no snapshot
  const a0 = await Life.peek(A);
  const row = (await pool.query(`SELECT accuracy, attr_peaks FROM tb_mm_character WHERE id_user = $1`, [A])).rows[0];
  check("acurácia gravada em 0 (coluna NOT NULL) e no pico", row.accuracy === 0 && row.attr_peaks.accuracy === 0, JSON.stringify(row));
  check("snapshot traz a acurácia", a0.character.attributes.accuracy === 0);

  // ── Poder guardado pela transação da vida = a fórmula
  const p0 = await powerOfRow(A);
  const at = a0.character.attributes;
  const want = powerScore(FightSim, { attrs: at, level: 1, gear: {} }).total;
  check("withLife grava o Poder do personagem (tb_mm_character.power)", p0 && p0.poder != null, JSON.stringify(p0));
  check("snapshot traz o mesmo Poder", a0.character.power === p0.poder, `${a0.character.power} vs ${p0.poder}`);
  check("Poder = soma dos atributos + 100 de HP (nível 1, sem equipamento)", p0.poder === want, `${p0 && p0.poder} vs ${want}`);

  // ── equipamento (E4, A13: armadura +5% defesa no nível 1 = 5% da base 100 = 5 pontos;
  //    a pilha antiga vira instância e o tb_mm_equip vira loadout no primeiro pedido)
  await pool.query(`INSERT INTO tb_mm_gear (id_user, item_id, qty, level) VALUES ($1, 'colete_couro', 1, 0)`, [A]);
  await pool.query(`INSERT INTO tb_mm_equip (id_user, slot, item_id) VALUES ($1, 'armor', 'colete_couro')`, [A]);
  await Life.peek(A);
  const p1 = { ...(await powerOfRow(A)), parts: await Poder.myParts(A) };
  check("equipamento entra: +5% de defesa no nível 1 = +5", p1.parts.gear === 5 && p1.poder - p0.poder >= 4 && p1.poder - p0.poder <= 6, JSON.stringify(p1));

  // ── nível: B treinou muito e subiu de nível
  await Life.peek(B);
  await pool.query(`UPDATE tb_mm_character SET strength = 800, speed = 600, accuracy = 120 WHERE id_user = $1`, [B]);
  await pool.query(
    `INSERT INTO tb_mm_char_adventure (id_character, id_user, xp, level)
     SELECT id_character, $1, 50000, 1 FROM tb_mm_character WHERE id_user = $1 AND status = 'alive'
     ON CONFLICT (id_character) DO UPDATE SET xp = 50000`,
    [B]
  );
  const lvB = require("../src/utils/meuMundoAdventure").levelOf(50000).level;
  await pool.query(`UPDATE tb_mm_char_adventure SET level = $2 WHERE id_user = $1`, [B, lvB]);
  await Life.peek(B);
  const pB = { ...(await powerOfRow(B)), parts: await Poder.myParts(B) };
  check("HP máx do nível entra no Poder", pB.parts.hp === 100 + 9 * (lvB - 1) && pB.parts.accuracy === 120, JSON.stringify(pB));

  // menor de idade tem linha mas não aparece
  await Life.peek(K);
  await pool.query(`UPDATE tb_mm_character SET strength = 9000 WHERE id_user = $1`, [K]);
  await Life.peek(K);

  // ── B3: outro personagem de B, mais fraco, e um morto mais forte: entra só o melhor vivo
  const ghost = crypto.randomUUID();
  await pool.query(
    `INSERT INTO tb_mm_character (id_character, id_user, generation, seed, personality, height_m, energy, satiety, mood, stress, health, vitality,
       fat_kg, lean_kg, diabetes_risk, bp_risk, toxicity, cardiac, awake_h, zero_energy_h, diet, intelligence, strength, speed, fertility, activity,
       activity_started_at, meals, day_acc, status, sim_at, died_at, death_cause)
     SELECT $2, id_user, generation + 1, seed, personality, height_m, energy, satiety, mood, stress, health, vitality,
       fat_kg, lean_kg, diabetes_risk, bp_risk, toxicity, cardiac, awake_h, zero_energy_h, diet, intelligence, strength, speed, fertility, activity,
       activity_started_at, meals, day_acc, 'dead', sim_at, NOW(), 'velhice'
       FROM tb_mm_character WHERE id_user = $1 LIMIT 1`,
    [B, ghost]
  ).catch((e) => console.log("(personagem extra)", e.message));
  await pool.query(`UPDATE tb_mm_character SET power = 99999 WHERE id_character = $1`, [ghost]);

  const rp = await Poder.ranking(A, "poder");
  check("aba Poder: B na frente, A em 2º", rp.top.length === 2 && rp.top[0].idUser === B && rp.top[1].idUser === A, JSON.stringify(rp.top.map((t) => [t.name, t.value])));
  check("aba Poder: uma linha por pessoa (morto não conta)", rp.top.filter((t) => t.idUser === B).length === 1 && rp.top[0].value === pB.poder);
  check("aba Poder: menor de idade fica fora", !rp.top.some((t) => t.idUser === K));
  check("aba Poder: minha posição", rp.me && rp.me.position === 2 && rp.me.value === p1.poder, JSON.stringify(rp.me));
  check("aba Poder: nome do perfil-conta e corpo", rp.top[0].name === "BIA" && typeof rp.top[0].body === "string" && rp.scope === "br");

  const rn = await Poder.ranking(A, "nivel");
  check("aba Nível: B (nível alto) na frente", rn.top[0].idUser === B && rn.top[0].value === lvB && rn.me.position === 2, JSON.stringify(rn.top.map((t) => [t.name, t.value])));

  // ── Freelandoo: o ranking geral do site (storage substituído aqui; o real precisa do banco do site)
  const pidA = (await pool.query(`SELECT id_profile FROM tb_profile WHERE id_user = $1`, [A])).rows[0].id_profile;
  const origTop = RankingStorage.getTopGeneral;
  const origPos = RankingStorage.getPublicProfilePosition;
  RankingStorage.getTopGeneral = async (_db, { limit }) => {
    check("Freelandoo pede o top 100", limit === 100);
    return [
      { id_profile: crypto.randomUUID(), display_name: "Zé", username: "ze", total_points: 900.4, position_general: 1, is_user_account: true },
      { id_profile: crypto.randomUUID(), display_name: "Lu", username: "lu", total_points: 500, position_general: 2, is_user_account: false },
    ];
  };
  RankingStorage.getPublicProfilePosition = async (_db, { id_profile }) => (id_profile === pidA ? { position_general: 37, total_points: 12 } : null);
  const rf = await Poder.ranking(A, "freelandoo");
  RankingStorage.getTopGeneral = origTop;
  RankingStorage.getPublicProfilePosition = origPos;
  check("aba Freelandoo: top do site com pontos", rf.top.length === 2 && rf.top[0].value === 900 && rf.top[0].name === "Zé");
  check("aba Freelandoo: minha posição pelo perfil-conta", rf.me && rf.me.position === 37 && rf.me.value === 12, JSON.stringify(rf.me));

  // ── mig 335: recalcula TODOS pela fórmula do B7 (zera e o backfill do boot refaz)
  await pool.query(`UPDATE tb_mm_character SET power = 7 WHERE id_user = $1`, [A]); // número da fórmula antiga
  await pool.query(fs.readFileSync(path.join(__dirname, "../src/databases/migrations/335_meu_mundo_poder_b7.sql"), "utf8"));
  const nulls = Number((await pool.query(`SELECT COUNT(*) AS n FROM tb_mm_character WHERE power IS NULL`)).rows[0].n);
  const redone = await require("../src/services/MeuMundoPowerService").backfill();
  const pA = await powerOfRow(A);
  check("mig 335 zera o poder e o backfill refaz todos", nulls >= 3 && redone === nulls && pA.poder === p1.poder, `${nulls} ${redone} ${pA.poder} vs ${p1.poder}`);

  const bad = await Poder.ranking(A, "xyz");
  check("aba desconhecida = 404", bad.error && bad.statusCode === 404);

  console.log(`\n${PASS} ok, ${FAIL} falha(s)`);
  await pool.end();
  process.exit(FAIL ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
