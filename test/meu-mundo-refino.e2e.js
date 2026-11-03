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
  await pool.query(`DROP TABLE IF EXISTS tb_mm_refine_proposal, tb_mm_gear_unlock, tb_mm_quest, tb_mm_equip, tb_mm_gear,
    tb_mm_fight, tb_mm_receipt, tb_mm_adventure, tb_mm_artifact, tb_mm_clan, tb_mm_car_paint_owned,
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
      await pool.query(`INSERT INTO tb_mm_adventure (id_user, xp) VALUES ($1, 500000)`, [user]);
      await pool.query(`UPDATE tb_mm_wallet SET coins = 500000 WHERE id_user = $1`, [user]);
    }
    for (const item of Gear.GEAR.filter((g) => ["material", "recipe", "cosmetic", "quest"].includes(g.category))) {
      await pool.query(`INSERT INTO tb_mm_gear (id_user,item_id,qty) VALUES ($1,$2,$3)`, [id, item.id, item.category === "material" ? 500 : 1]);
    }
    await pool.query(`INSERT INTO tb_mm_gear (id_user,item_id,qty,level) VALUES ($1,'espada_latao',1,4),($1,'espada_aprendiz',1,0)`, [id]);
    await Service.equip(id, { slot: "weapon", item: "espada_latao" });
    const balance = async () => Number((await pool.query(`SELECT coins FROM tb_mm_wallet WHERE id_user=$1`, [id])).rows[0].coins);
    const row = async () => (await pool.query(`SELECT level,refine_failures,version FROM tb_mm_gear WHERE id_user=$1 AND item_id='espada_latao'`, [id])).rows[0];
    const quote = async (protect = false) => (await Service.get(id)).bag.refinement.espada_latao[protect ? "protected" : "standard"];
    const refine = async (protect = false) => Service.refine(id, { item: "espada_latao", key: key(), quote: (await quote(protect)).id, protect });
    const reset = async (level = 4, failures = 0) => pool.query(`UPDATE tb_mm_gear SET level=$2,refine_failures=$3,version=version+1 WHERE id_user=$1 AND item_id='espada_latao'`, [id, level, failures]);

    const beforeInvalid = await balance();
    const legacy = await Service.upgrade(id, { item: "espada_latao", key: key() });
    check("endpoint antigo exige ver chances antes de cobrar", legacy.code === "quote" && await balance() === beforeInvalid);
    check("proteção aceita apenas booleano", (await Service.refine(id, { item: "espada_latao", key: key(), protect: "false" })).code === "decision");
    const oldQuote = await quote();
    await reset();
    check("prévia desatualizada é recusada sem cobrança", (await Service.refine(id, { item: "espada_latao", key: key(), quote: oldQuote.id })).code === "quote" && await balance() === beforeInvalid);

    // Uma proposta paga, com queda, enviada por duas abas simultâneas.
    let draws = 0;
    Service.R = () => { draws++; return 0.99; };
    const q = await quote(), request = { item: "espada_latao", key: key(), quote: q.id, protect: false };
    const money0 = await balance();
    const material0 = (await Service.get(id)).bag.owned.fragmento_lamina.qty;
    const stable0 = (await pool.query(`SELECT attr_peaks,growth,born_at FROM tb_mm_character WHERE id_user=$1 ORDER BY generation DESC LIMIT 1`, [id])).rows[0];
    const xp0 = (await pool.query(`SELECT xp FROM tb_mm_adventure WHERE id_user=$1`, [id])).rows[0].xp;
    const [a, b] = await Promise.all([Service.refine(id, request), Service.refine(id, request)]);
    check("duas abas recebem mesma proposta e recibo", a.proposal?.id === b.proposal?.id && a.receipt?.eventId === b.receipt?.eventId);
    check("sorteio e cobrança acontecem uma vez", draws === 1 && await balance() === money0 - q.cost.coins);
    check("materiais debitados uma vez", (await Service.get(id)).bag.owned.fragmento_lamina.qty === material0 - q.cost.needs.fragmento_lamina);
    check("resultado menor permanece candidato até aceitar", a.proposal.candidateLevel === 3 && (await row()).level === 4);
    check("pity avança no sorteio pago", (await row()).refine_failures === 1);
    check("chave reaproveitada com outro pedido é recusada", (await Service.refine(id, { ...request, protect: true })).code === "key_conflict");
    check("proposta bloqueia reciclagem", (await Service.recycle(id, { item: "espada_latao", key: key() })).code === "locked");
    check("proposta bloqueia desequipar e trocar arma", (await Service.equip(id, { slot: "weapon" })).code === "locked" && (await Service.equip(id, { slot: "weapon", item: "espada_aprendiz" })).code === "locked");
    check("proposta bloqueia novo sorteio", (await Service.refine(id, { item: "espada_latao", key: key(), quote: q.id })).code === "locked");
    check("outra conta não lê nem resolve proposta", (await Service.resolveRefine(stranger, { proposalId: a.proposal.id, accept: true, key: key() })).code === "proposal");
    check("aceite precisa de booleano explícito", (await Service.resolveRefine(id, { proposalId: a.proposal.id, accept: "false", key: key() })).code === "decision");
    const resolveKey = key(), paid = await balance();
    const [yes1, yes2] = await Promise.all([Service.resolveRefine(id, { proposalId: a.proposal.id, accept: true, key: resolveKey }), Service.resolveRefine(id, { proposalId: a.proposal.id, accept: true, key: resolveKey })]);
    check("aceite concorrente aplica queda uma vez", yes1.receipt.eventId === yes2.receipt.eventId && (await row()).level === 3 && await balance() === paid);
    check("recusa após aceite não reverte equipamento", (await Service.resolveRefine(id, { proposalId: a.proposal.id, accept: false, key: key() })).code === "resolved" && (await row()).level === 3);
    const stable1 = (await pool.query(`SELECT attr_peaks,growth,born_at FROM tb_mm_character WHERE id_user=$1 ORDER BY generation DESC LIMIT 1`, [id])).rows[0];
    assert.deepEqual(stable1, stable0);
    check("XP, idade, crescimento e picos permanentes ficam preservados", (await pool.query(`SELECT xp FROM tb_mm_adventure WHERE id_user=$1`, [id])).rows[0].xp === xp0);

    // Recusa e expiração preservam item, mas nunca devolvem custo.
    await reset(4, 2);
    const failed = await refine(), failedPaid = await balance();
    const discarded = await Service.resolveRefine(id, { proposalId: failed.proposal.id, accept: false, key: key() });
    check("recusar mantém nível e gasto", discarded.proposal.status === "discarded" && (await row()).level === 4 && await balance() === failedPaid);
    const guaranteed = await quote();
    check("3 falhas pagas garantem próxima tentativa", guaranteed.pity.guaranteed && guaranteed.odds.up === 1 && guaranteed.odds.down === 0);
    const success = await refine();
    check("garantia independe do sorteio alto", success.proposal.candidateLevel === 5 && (await row()).refine_failures === 0);
    await Service.resolveRefine(id, { proposalId: success.proposal.id, accept: false, key: key() });
    check("descartar sucesso não permite guardar garantia", !(await quote()).pity.guaranteed && (await row()).level === 4);
    const expiry = await refine(), expiryPaid = await balance();
    await pool.query(`UPDATE tb_mm_refine_proposal SET created_at=NOW()-INTERVAL '20 minutes',expires_at=NOW()-INTERVAL '1 minute' WHERE id_proposal=$1`, [expiry.proposal.id]);
    const expired = await Service.resolveRefine(id, { proposalId: expiry.proposal.id, accept: true, key: key() });
    check("expiração do servidor descarta sem aplicar nem estornar", expired.proposal.status === "expired" && (await row()).level === 4 && await balance() === expiryPaid);
    check("GET libera item expirado", !(await Service.get(id)).bag.pendingProposals.length);

    await reset(4, 0);
    const protectedResult = await refine(true);
    check("proteção paga impede candidato menor", protectedResult.proposal.candidateLevel === 4 && protectedResult.proposal.protection.enabled);
    await Service.resolveRefine(id, { proposalId: protectedResult.proposal.id, accept: false, key: key() });
    await reset(6, 0);
    const floor = await quote(true);
    check("no piso +6 não cobra proteção inútil", floor.floor === 6 && floor.odds.down === 0 && !floor.protection.enabled);

    // Uma exceção depois do débito deve reverter custos e contador.
    await reset(4, 0);
    const rollbackQuote = await quote(), rollbackMoney = await balance(), rollbackRow = await row();
    const insert = Store.insertProposal;
    Store.insertProposal = async () => { throw new Error("injected rollback"); };
    try {
      await assert.rejects(Service.refine(id, { item: "espada_latao", key: key(), quote: rollbackQuote.id }), /injected rollback/);
    } finally { Store.insertProposal = insert; }
    assert.deepEqual(await row(), rollbackRow);
    check("falha após débito reverte tudo", await balance() === rollbackMoney);

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
