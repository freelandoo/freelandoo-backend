// Trilha E, fase 3 (E8–E11) depois da weapon-v1 (24/11/2026): a forja antiga saiu — conversão do que a conta
// tinha, receitas antigas 404, ações antigas 410, migrations idempotentes. EXCLUSIVAMENTE banco local descartável:
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
function check(name, condition, info = "") { assert.ok(condition, name + (info ? " — " + info : "")); checks++; console.log(`✓ ${name}`); }

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

    // ── weapon-v1 (24/11/2026): a forja antiga (E8–E11) saiu do jogo. Esta suíte prova que quem tinha não
    // perde nada e que as rotas antigas respondem 410; o refino/estrelas/montagem novos estão em meu-mundo-refino.
    const WP = require("../src/utils/mmItems/rules/weaponProgress");
    await setQty(id, "frag_garras_lunares", 61);
    await setQty(id, "frag_vigilia", 25);
    await setQty(id, "lingote_refinado", 4);
    await setQty(id, "receita_garras_lunares", 1);
    await setQty(id, "po_de_lua", 20);
    // a arma de linha que alguém fabricou antes (forge-v2, +4, grau III) continua da pessoa
    const line = (await pool.query(`INSERT INTO tb_mm_gear_instance (id_user,item_id,plus,grade,rules) VALUES ($1,'linha_garras_lunares',4,3,'forge-v2') RETURNING id_instance`, [id])).rows[0].id_instance;
    const bag = (await Service.get(id)).bag;
    check("conversão: 61 fragmentos da arma de linha → 21 de classe Lendária; 25 de conjunto → 13 de classe B",
      (await qty(id, "frag_garras_lunares")) === 0 && (await qty(id, "frag_classe_legendary")) === 21 && (await qty(id, "frag_vigilia")) === 0 && (await qty(id, "frag_classe_b")) === 13);
    check("conversão: Lingote → pó A (2:1); a receita aposentada (T5) vira +1 pó A; Pó de Lua (bestiário) fica",
      (await qty(id, "lingote_refinado")) === 0 && (await qty(id, "po_ref_a")) === 3 && (await qty(id, "receita_garras_lunares")) === 0 && (await qty(id, "po_de_lua")) === 20);
    const lineRow = (await instances(id, "linha_garras_lunares"))[0];
    check("a arma de linha vira nível 25 (+4) e 3 estrelas (grau III), com o retrato de antes guardado",
      lineRow.weapon_level === WP.levelFromPlus(4) && lineRow.weapon_level === 25 && lineRow.grade === 3 && lineRow.rules === "weapon-v1" && lineRow.legacy.plus === 4 && bag.instances.find((x) => x.id === line).stars === 3);
    const ledger = (await pool.query(`SELECT item_id, SUM(delta) AS d FROM tb_mm_item_ledger WHERE id_user=$1 GROUP BY item_id`, [id])).rows;
    const sum = Object.fromEntries(ledger.map((r) => [r.item_id, Number(r.d)]));
    const piles = Object.fromEntries((await pool.query(`SELECT item_id, qty FROM tb_mm_gear WHERE id_user=$1`, [id])).rows.map((r) => [r.item_id, Number(r.qty)]));
    check("o livro de itens bate com a pilha depois da troca (o antigo zera, o novo entra)", ["frag_garras_lunares", "frag_vigilia", "frag_classe_legendary", "frag_classe_b", "po_ref_a"].every((it) => (sum[it] || 0) === (piles[it] || 0)) && sum.frag_garras_lunares === 0, JSON.stringify(sum));

    // ── receitas da forja antiga sumiram; as que ficaram (bestiário/preparo) seguem
    check("receita de arma de linha não existe mais (404)", (await Service.forge(id, { recipe: "fabricar_garras_lunares", key: key() })).code === "recipe");
    check("receita de peça/montagem não existe mais (404)", (await Service.forge(id, { recipe: "forjar_luvas", key: key() })).code === "recipe");
    for (const m of ["upgrade", "grade", "salvage", "transmute", "convertFragments", "socket", "unsocket", "fuseRunes", "ascend", "awaken", "enchant", "enchantResolve"]) {
      const r = await Service[m](id, { item: "linha_garras_lunares", instance: line, key: key(), qty: 1, from: "po_de_lua", to: "seiva_de_prata", confirm: true });
      assert.equal(r.statusCode, 410, m);
    }
    check("aprimorar, graus, desmontar, transmutar, converter fragmento, runas, Ascensão, Despertar e encanto dão 410 sem mexer em nada",
      (await instances(id, "linha_garras_lunares")).length === 1 && (await qty(id, "po_de_lua")) === 20);

    // ── migrations: a 448 (forge-v1 → v2) e a 466 (nível/estrelas) rodam de novo sem mudar nada
    const old = (await pool.query(`INSERT INTO tb_mm_gear_instance (id_user,item_id,plus,rules) VALUES ($1,'espada_latao',7,'forge-v1') RETURNING id_instance`, [id])).rows[0].id_instance;
    for (const f of ["448_meu_mundo_aprimoramento_garantido.sql", "466_meu_mundo_armas_nivel_estrelas.sql"]) {
      const sql = fs.readFileSync(path.join(__dirname, "../src/databases/migrations", f), "utf8");
      await pool.query(sql);
      await pool.query(sql);
    }
    await Service.get(id);
    const conv = (await pool.query(`SELECT plus, weapon_level, rules FROM tb_mm_gear_instance WHERE id_instance=$1`, [old])).rows[0];
    check("forge-v1 +7 → +11 (mig 448) → nível 67 (weapon-v1), idempotente", conv.plus === 11 && conv.weapon_level === WP.levelFromPlus(11) && conv.rules === "weapon-v1");

    // ── trava e reciclar continuam
    const k = () => crypto.randomUUID();
    const exists = async (inst) => (await pool.query(`SELECT 1 FROM tb_mm_gear_instance WHERE id_instance=$1`, [inst])).rowCount === 1;
    const shop = (await pool.query(`INSERT INTO tb_mm_gear_instance (id_user,item_id,rules) VALUES ($1,'espada_aco','weapon-v1') RETURNING id_instance`, [id])).rows[0].id_instance;
    await Service.lock(id, { instance: shop, locked: true });
    check("travada não recicla", (await Service.recycle(id, { item: "espada_aco", key: k() })).code === "pinned" && (await exists(shop)));
    await Service.lock(id, { instance: shop, locked: false });
    check("cópia de outra conta não trava", (await Service.lock(other, { instance: shop, locked: true })).code === "instance");

    console.log(`${checks} verificações de integração passaram.`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
