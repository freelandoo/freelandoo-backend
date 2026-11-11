// Integração real da forja/refino. EXCLUSIVAMENTE banco local descartável.
// TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55433/mm_refine_test node test/meu-mundo-refino.e2e.js
const target = process.env.TEST_DATABASE_URL;
let parsed;
try { parsed = new URL(target); } catch { /* guard below */ }
if (!parsed || !["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/mm_refine_test") {
  console.error("Use somente TEST_DATABASE_URL local com banco descartável mm_refine_test.");
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
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    await pool.query(sql);
    if (file.startsWith("323_")) await pool.query(sql);
  }
}

async function main() {
  const pool = require("../src/databases");
  const Service = require("../src/services/MeuMundoGearService");
  const Store = require("../src/storages/MeuMundoGearStorage");
  const Life = require("../src/services/MeuMundoLifeService");
  const Gear = require("../src/utils/meuMundoGear");
  Life.adminPerks = false;
  const originalR = Service.R;
  try {
    await bootstrap(pool);
    const id = key(), stranger = key();
    for (const user of [id, stranger]) {
      await pool.query(`INSERT INTO tb_user VALUES ($1, 'forge', 'forge@mm.test')`, [user]);
      await Life.peek(user);
      await pool.query(`INSERT INTO tb_mm_clan (id_user, clan, sex) VALUES ($1, 'vampiro', 'm')`, [user]);
      await pool.query(`INSERT INTO tb_mm_char_adventure (id_character, id_user, xp) SELECT id_character, $1, 500000 FROM tb_mm_character WHERE id_user = $1 AND status = 'alive'`, [user]);
      // A7 (migs 330/332): as moedas do jogo são a Esmeralda; tb_mm_wallet só guarda a fração.
      await pool.query(`INSERT INTO emerald_wallets (user_id, balance) VALUES ($1, 500000) ON CONFLICT (user_id) DO UPDATE SET balance = 500000`, [user]);
    }
    for (const item of Gear.GEAR.filter((g) => ["material", "recipe", "cosmetic", "quest"].includes(g.category))) {
      await pool.query(`INSERT INTO tb_mm_gear (id_user,item_id,qty) VALUES ($1,$2,$3)`, [id, item.id, item.category === "material" ? 500 : 1]);
    }
    await pool.query(`INSERT INTO tb_mm_gear (id_user,item_id,qty,level) VALUES ($1,'espada_latao',1,4),($1,'espada_aprendiz',1,0)`, [id]);
    await Service.equip(id, { slot: "weapon", item: "espada_latao" });
    const balance = async () => Math.floor((await Service.get(id)).bag.coins);
    // E2: a espada da pilha antiga virou instância no primeiro pedido (materialize); o refino é dela.
    const row = async () => (await pool.query(`SELECT plus AS level,ascended,version FROM tb_mm_gear_instance WHERE id_user=$1 AND item_id='espada_latao'`, [id])).rows[0];
    const reset = async (level = 6, ascended = false) => pool.query(`UPDATE tb_mm_gear_instance SET plus=$2,ascended=$3,version=version+1 WHERE id_user=$1 AND item_id='espada_latao'`, [id, level, ascended]);
    const stones = async () => (await Service.get(id)).bag.owned.pedra_aprimoramento?.qty || 0;
    const setStones = (n) => pool.query(`UPDATE tb_mm_gear SET qty=$2 WHERE id_user=$1 AND item_id='pedra_aprimoramento'`, [id, n]);
    // E2 + E9 (A2): a espada da pilha antiga virou instância no primeiro pedido e o +4 da forge-v1 virou +6
    check("E9: pilha antiga +4 virou instância +6 (forge-v2) e ficou equipada", (await row()).level === 6 && (await Service.get(id)).bag.equipped.weapon === "espada_latao");

    // E9: o refino sorteado acabou
    const gone = await Service.refine(id, { item: "espada_latao", key: key(), quote: "x" });
    const goneR = await Service.resolveRefine(id, { proposalId: key(), accept: true, key: key() });
    check("E9: refino sorteado e aceite de proposta respondem 410", gone.statusCode === 410 && goneR.statusCode === 410);

    // Aprimoramento garantido por duas abas com a mesma chave: sobe uma vez, cobra uma vez.
    const cost = (await Service.get(id)).bag.forge[(await Service.get(id)).bag.owned.espada_latao.instance].upgrade;
    check("E9: custo fixo do +7 pela tabela do tier (T2: 730 Esmeraldas, 5 pedras)", cost.to === 7 && cost.coins === 730 && cost.needs.pedra_aprimoramento === 5 && !cost.blocked);
    const money0 = await balance(), stones0 = await stones();
    const stable0 = (await pool.query(`SELECT attr_peaks,growth,born_at FROM tb_mm_character WHERE id_user=$1 ORDER BY generation DESC LIMIT 1`, [id])).rows[0];
    const xp0 = (await pool.query(`SELECT xp FROM tb_mm_char_adventure WHERE id_user=$1`, [id])).rows[0].xp;
    const request = { item: "espada_latao", key: key() };
    const [a, b] = await Promise.all([Service.upgrade(id, request), Service.upgrade(id, request)]);
    check("E9: duas abas recebem o mesmo recibo", a.receipt?.eventId === b.receipt?.eventId);
    check("E9: sempre sobe, uma vez só", (await row()).level === 7 && a.receipt.result.from === 6 && a.receipt.result.to === 7);
    check("E9: cobra Esmeraldas e Pedras uma vez", await balance() === money0 - 730 && await stones() === stones0 - 5);
    check("E9: o recibo mostra o bônus antes e depois", a.receipt.result.bonusAfter.dmg > a.receipt.result.bonusBefore.dmg);
    const stable1 = (await pool.query(`SELECT attr_peaks,growth,born_at FROM tb_mm_character WHERE id_user=$1 ORDER BY generation DESC LIMIT 1`, [id])).rows[0];
    assert.deepEqual(stable1, stable0);
    check("XP, idade, crescimento e picos permanentes ficam preservados", (await pool.query(`SELECT xp FROM tb_mm_char_adventure WHERE id_user=$1`, [id])).rows[0].xp === xp0);

    // Sem material ou sem moeda: recusa sem cobrar.
    await setStones(4);
    const poor = await balance();
    check("E9: sem pedra suficiente recusa e não cobra", (await Service.upgrade(id, { item: "espada_latao", key: key() })).code === "needs" && await balance() === poor && await stones() === 4 && (await row()).level === 7);
    await setStones(500);
    await pool.query(`UPDATE emerald_wallets SET balance=10 WHERE user_id=$1`, [id]);
    check("E9: sem Esmeraldas recusa e não gasta pedra", (await Service.upgrade(id, { item: "espada_latao", key: key() })).code === "coins" && await stones() === 500);
    await pool.query(`UPDATE emerald_wallets SET balance=500000 WHERE user_id=$1`, [id]);

    // +11 em diante só ascendida; +15 é o teto.
    await reset(10, false);
    const blockedView = (await Service.get(id)).bag.forge[(await Service.get(id)).bag.owned.espada_latao.instance].upgrade;
    check("E9: +10 sem ascensão recusa o +11", (await Service.upgrade(id, { item: "espada_latao", key: key() })).code === "ascend" && (await row()).level === 10 && blockedView.blocked === "ascend");
    await reset(10, true);
    check("E9: ascendida passa do +10", !(await Service.upgrade(id, { item: "espada_latao", key: key() })).error && (await row()).level === 11);
    await reset(15, true);
    check("E9: no +15 não sobe mais", (await Service.upgrade(id, { item: "espada_latao", key: key() })).code === "max");

    // Uma exceção depois do débito deve reverter tudo.
    await reset(6, false);
    const rollbackMoney = await balance(), rollbackStones = await stones(), rollbackRow = await row();
    const setPlus = Store.setPlus;
    Store.setPlus = async () => { throw new Error("injected rollback"); };
    try {
      await assert.rejects(Service.upgrade(id, { item: "espada_latao", key: key() }), /injected rollback/);
    } finally { Store.setPlus = setPlus; }
    assert.deepEqual(await row(), rollbackRow);
    check("falha após débito reverte tudo", await balance() === rollbackMoney && await stones() === rollbackStones);

    // Receitas persistentes, uma peça por forja, montagem explícita.
    const learnRequest = { item: "receita_eter", key: key() };
    const learned = await Service.use(id, learnRequest), learnedAgain = await Service.use(id, learnRequest);
    check("aprender receita consome cópia uma vez e persiste", learned.receipt.eventId === learnedAgain.receipt.eventId && learned.bag.learnedRecipes.includes("receita_eter") && !learned.bag.owned.receita_eter);
    const part = Gear.RECIPES.find((r) => r.kind === "part");
    const partBefore = (await Service.get(id)).bag.owned[part.out].qty;
    const partRequest = { recipe: part.id, key: key() };
    const [part1, part2] = await Promise.all([Service.forge(id, partRequest), Service.forge(id, partRequest)]);
    check("cada forja fabrica só uma peça, inclusive reenvio", part1.receipt.eventId === part2.receipt.eventId && part1.bag.owned[part.out].qty === partBefore + 1);
    const assembly = Gear.RECIPES.find((r) => r.kind === "assembly" && r.out === "espada_eter");
    const assembled = await Service.forge(id, { recipe: assembly.id, key: key() });
    check("receita aprendida funciona sem cópia na mochila", assembled.bag?.owned.espada_eter?.qty === 1 && Object.keys(assembly.needs).length === 12);
    for (const [material, n] of Object.entries(assembly.needs)) assert.equal(assembled.bag.owned[material].qty, (material === part.out ? partBefore + 1 : 500) - n);
    check("montagem consome exatamente uma de cada parte", true);
    const appearance = await Service.use(id, { item: "pintura_arma_eter", key: key() });
    check("cosmético ativa aparência sem consumir posse", appearance.bag.activeCosmetic === "pintura_arma_eter" && appearance.bag.owned.pintura_arma_eter.qty === 1);
    const emote = await Service.use(id, { item: "emote_saudacao", key: key() });
    check("emote não substitui aparência da arma", emote.bag.unlockedEmotes.includes("emote_saudacao") && emote.bag.activeCosmetic === "pintura_arma_eter");
    const quest = await Service.use(id, { item: "cristal_morkhan", key: key() });
    check("examinar missão devolve lore sem consumir item ou XP", quest.receipt.result.lore && quest.bag.owned.cristal_morkhan.qty === 1 && !quest.receipt.deltas.xp);
    check("material não inventa efeito direto", (await Service.use(id, { item: "fragmento_lamina", key: key() })).code === "use");
    console.log(`\n${checks} verificações de integração passaram.`);
  } finally {
    Service.R = originalR;
    await pool.end();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
