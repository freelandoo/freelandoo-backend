// Trilha E, fase 3 (E8–E11): fragmentos e armas de linha, aprimoramento garantido, refinamento I–V,
// desmontar e transmutar. EXCLUSIVAMENTE banco local descartável:
// TEST_DATABASE_URL=postgres://postgres:<senha>@127.0.0.1:55432/mm_forja_test node test/meu-mundo-forja.e2e.js
const target = process.env.TEST_DATABASE_URL;
let parsed;
try { parsed = new URL(target); } catch { /* guard below */ }
if (!parsed || !["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/mm_forja_test") {
  console.error("Use somente TEST_DATABASE_URL local com banco descartável mm_forja_test.");
  process.exit(2);
}
process.env.DATABASE_URL = target;
process.env.DATABASE_SSL = "false";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const key = () => crypto.randomUUID();
let checks = 0;
function check(name, condition) { assert.ok(condition, name); checks++; console.log(`✓ ${name}`); }

async function bootstrap(pool) {
  await pool.query(`DROP TABLE IF EXISTS tb_mm_loadout, tb_mm_item_ledger, tb_mm_gear_instance, tb_mm_refine_proposal, tb_mm_gear_unlock, tb_mm_quest, tb_mm_equip, tb_mm_gear,
    tb_mm_fight, tb_mm_receipt, tb_mm_char_adventure, tb_mm_adventure, tb_mm_artifact, tb_mm_clan, tb_mm_car_paint_owned,
    tb_mm_consume_key, tb_mm_pantry, tb_mm_skin_owned, tb_mm_character_event, tb_mm_character_day,
    tb_mm_character, tb_mm_wallet, tb_mm_notice, tb_mm_mail, tb_mm_visit, tb_mm_avatar_pref,
    tb_mm_residence, tb_mm_house, tb_mm_lot, tb_mm_neighborhood, tb_user_role, tb_role, tb_user CASCADE`);
  await pool.query(`CREATE TABLE tb_user (id_user UUID PRIMARY KEY, username TEXT, email TEXT)`);
  await pool.query(`CREATE TABLE tb_role (id_role SERIAL PRIMARY KEY, desc_role TEXT, is_active BOOLEAN DEFAULT TRUE)`);
  await pool.query(`CREATE TABLE tb_user_role (id_user UUID, id_role INT, is_active BOOLEAN DEFAULT TRUE)`);
  await pool.query(`INSERT INTO tb_role (desc_role) VALUES ('Administrator')`);
  await require("./helpers/mmPolens").polenTables(pool);
  const dir = path.join(__dirname, "../src/databases/migrations");
  for (const file of fs.readdirSync(dir).filter((f) => /^\d{3}_meu_mundo/.test(f) && Number(f.slice(0, 3)) >= 291 && !/^(303|312)_/.test(f)).sort()) {
    await pool.query(fs.readFileSync(path.join(dir, file), "utf8"));
  }
}

async function main() {
  const pool = require("../src/databases");
  const Service = require("../src/services/MeuMundoGearService");
  const Life = require("../src/services/MeuMundoLifeService");
  Life.adminPerks = false;
  const qty = async (u, item) => Number((await pool.query(`SELECT COALESCE(SUM(qty),0) AS n FROM tb_mm_gear WHERE id_user=$1 AND item_id=$2`, [u, item])).rows[0].n);
  const setQty = (u, item, n) => pool.query(`INSERT INTO tb_mm_gear (id_user,item_id,qty,level) VALUES ($1,$2,$3,0) ON CONFLICT (id_user,item_id) DO UPDATE SET qty=EXCLUDED.qty`, [u, item, n]);
  const instances = async (u, item) => (await pool.query(`SELECT * FROM tb_mm_gear_instance WHERE id_user=$1 AND item_id=$2 ORDER BY created_at`, [u, item])).rows;
  const emeralds = async (u) => Number((await pool.query(`SELECT balance FROM emerald_wallets WHERE user_id=$1`, [u])).rows[0].balance);
  try {
    await bootstrap(pool);
    const id = key(), other = key();
    for (const user of [id, other]) {
      await pool.query(`INSERT INTO tb_user VALUES ($1, 'forja', 'forja@mm.test')`, [user]);
      await Life.peek(user);
      await pool.query(`INSERT INTO tb_mm_clan (id_user, clan, sex) VALUES ($1, 'vampiro', 'm')`, [user]);
      await pool.query(`INSERT INTO tb_mm_char_adventure (id_character, id_user, xp) SELECT id_character, $1, 500000 FROM tb_mm_character WHERE id_user = $1 AND status = 'alive'`, [user]);
      await pool.query(`INSERT INTO emerald_wallets (user_id, balance) VALUES ($1, 500000) ON CONFLICT (user_id) DO UPDATE SET balance = 500000`, [user]);
    }

    // ── E8: fabricar por fragmentos ──
    const mats = { po_de_lua: 20, seiva_de_prata: 3, lingote_refinado: 4, essencia_primordial: 1, receita_garras_lunares: 1 };
    for (const [m, n] of Object.entries(mats)) await setQty(id, m, n);
    await setQty(id, "frag_garras_lunares", 59);
    const short = await Service.forge(id, { recipe: "fabricar_garras_lunares", key: key() });
    check("E8: 59 fragmentos recusa a arma de linha", short.code === "needs" && short.statusCode === 409);
    await setQty(id, "frag_garras_lunares", 61);
    const before = await emeralds(id);
    const made = await Service.forge(id, { recipe: "fabricar_garras_lunares", key: key() });
    const inst = await instances(id, "linha_garras_lunares");
    check("E8: 60 fragmentos fabricam a arma (instância +0, grau I)", !made.error && inst.length === 1 && inst[0].plus === 0 && inst[0].grade === 1);
    check("E8: a forja cobra 60 fragmentos, os materiais e 2.360 Esmeraldas", (await qty(id, "frag_garras_lunares")) === 1 && (await qty(id, "po_de_lua")) === 0 && before - (await emeralds(id)) === 2360);
    check("E8: o recibo aponta a instância criada", made.receipt && made.receipt.result.instance === inst[0].id_instance);
    const again = await Service.forge(id, { recipe: "fabricar_garras_lunares", key: key() });
    check("E8: a segunda cópia da mesma arma de linha é recusada", again.code === "max" || again.code === "needs");

    // ── E8: o que sobra vira Pó de Refino ──
    await setQty(id, "frag_vigilia", 25);
    const ck = key();
    const conv = await Service.convertFragments(id, { item: "frag_vigilia", qty: 5, key: ck });
    check("E8: excedente converte (5 fragmentos raros = 30 de Pó de Refino)", !conv.error && (await qty(id, "frag_vigilia")) === 20 && (await qty(id, "po_refino")) === 30);
    const replay = await Service.convertFragments(id, { item: "frag_vigilia", qty: 5, key: ck });
    check("E8: mesma chave duas vezes converte uma", replay.replay === true && (await qty(id, "po_refino")) === 30);
    const lendario = await Service.convertFragments(id, { item: "frag_garras_lunares", qty: 1, key: key() });
    check("E8: fragmento lendário = 10 de Pó de Refino", !lendario.error && (await qty(id, "po_refino")) === 40);
    check("E8: converter mais do que tem é recusado", (await Service.convertFragments(id, { item: "frag_vigilia", qty: 21, key: key() })).code === "owned");
    check("E8: só fragmento converte", (await Service.convertFragments(id, { item: "po_de_lua", qty: 1, key: key() })).code === "notfragment");
    const ledger = (await pool.query(`SELECT SUM(delta) AS d FROM tb_mm_item_ledger WHERE id_user=$1 AND item_id='po_refino'`, [id])).rows[0].d;
    check("E8: o livro de itens bate com a pilha", Number(ledger) === (await qty(id, "po_refino")));

    // E9/E10/E11 entram abaixo
    const ctx = { pool, Service, id, other, qty, setQty, instances, emeralds, line: inst[0].id_instance };
    for (const step of STEPS) await step(ctx);

    console.log(`${checks} verificações de integração passaram.`);
  } finally {
    await pool.end();
  }
}
/** As fatias seguintes da fase 3 acrescentam seus passos aqui. */
const STEPS = [
  // ── E9: aprimoramento garantido ──
  async ({ pool, Service, id, setQty, qty, emeralds, line }) => {
    await setQty(id, "pedra_aprimoramento", 3);
    const before = await emeralds(id);
    const up = await Service.upgrade(id, { item: "linha_garras_lunares", instance: line, key: crypto.randomUUID() });
    check("E9: arma de linha (T5) sobe +0 → +1 por 350 Esmeraldas e 1 pedra", !up.error && up.receipt.result.to === 1 && before - (await emeralds(id)) === 350 && (await qty(id, "pedra_aprimoramento")) === 2);
    // A2 pela migration: uma cópia ainda em forge-v1 vira +round(1,5 × N) e roda de novo sem mudar nada
    const old = (await pool.query(`INSERT INTO tb_mm_gear_instance (id_user,item_id,plus,rules) VALUES ($1,'espada_latao',7,'forge-v1') RETURNING id_instance`, [id])).rows[0].id_instance;
    const sql = fs.readFileSync(path.join(__dirname, "../src/databases/migrations/448_meu_mundo_aprimoramento_garantido.sql"), "utf8");
    await pool.query(sql);
    await pool.query(sql);
    const conv = (await pool.query(`SELECT plus, ascended, rules FROM tb_mm_gear_instance WHERE id_instance=$1`, [old])).rows[0];
    check("E9: mig 448 converte +7 em +11 ascendida, idempotente", conv.plus === 11 && conv.ascended === true && conv.rules === "forge-v2");
    const fresh = (await pool.query(`INSERT INTO tb_mm_gear_instance (id_user,item_id) VALUES ($1,'espada_latao') RETURNING rules`, [id])).rows[0];
    check("E9: instância nova nasce em forge-v2", fresh.rules === "forge-v2");
  },
];

main().catch((error) => { console.error(error); process.exit(1); });
