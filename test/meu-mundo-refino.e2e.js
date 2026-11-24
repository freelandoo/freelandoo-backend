// Integração real do refino/forja das ARMAS (weapon-v1, 24/11/2026). EXCLUSIVAMENTE banco local descartável.
// TEST_DATABASE_URL=postgres://postgres:<senha>@127.0.0.1:55432/mm_refine_test node test/meu-mundo-refino.e2e.js
//
// Cobre: conversão sem perda (+N → nível, grau → estrelas, pilha aposentada → pó/fragmento novo), refino com
// pó (sucesso/falha, teto, mesma chave, chave em outra cópia, duas abas, versão velha, regra velha), estrelas
// (doadora válida/inválida, teto), montagem por fragmento de classe (escolha, repetida, saldo curto, mesma
// chave), o poder da luta e as rotas antigas respondendo 410.
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
    if (file.startsWith("323_") || file.startsWith("466_")) await pool.query(sql); // idempotente
  }
}

async function main() {
  const pool = require("../src/databases");
  const Service = require("../src/services/MeuMundoGearService");
  const Life = require("../src/services/MeuMundoLifeService");
  const Items = require("../src/utils/mmItems");
  const WP = require("../src/utils/mmItems/rules/weaponProgress");
  Life.adminPerks = false;
  const originalR = Service.R;
  try {
    await bootstrap(pool);
    const id = key(), other = key();
    for (const user of [id, other]) {
      await pool.query(`INSERT INTO tb_user VALUES ($1, 'forge', 'forge@mm.test')`, [user]);
      await Life.peek(user);
      await pool.query(`INSERT INTO tb_mm_clan (id_user, clan, sex) VALUES ($1, 'vampiro', 'm')`, [user]);
      await pool.query(`INSERT INTO tb_mm_char_adventure (id_character, id_user, xp) SELECT id_character, $1, 500000 FROM tb_mm_character WHERE id_user = $1 AND status = 'alive'`, [user]);
      await pool.query(`INSERT INTO emerald_wallets (user_id, balance) VALUES ($1, 500000) ON CONFLICT (user_id) DO UPDATE SET balance = 500000`, [user]);
    }

    // ── conversão: a pilha antiga (+4 da forge-v1) vira instância, +6 (forge-v2) e então nível 37 (weapon-v1)
    await pool.query(`INSERT INTO tb_mm_gear (id_user,item_id,qty,level) VALUES ($1,'espada_latao',1,4)`, [id]);
    await pool.query(`INSERT INTO tb_mm_gear (id_user,item_id,qty) VALUES ($1,'pedra_aprimoramento',7),($1,'po_refino',25),($1,'catalisador_refino',2),($1,'embriao_kragor',1),($1,'po_de_lua',9)`, [id]);
    await Service.equip(id, { slot: "weapon", item: "espada_latao" });
    let bag = (await Service.get(id)).bag;
    const sword = bag.instances.find((x) => x.item === "espada_latao");
    check("conversão: +6 virou nível 37 (nunca rebaixa) e 1 estrela; a cópia segue vestida",
      sword.weaponLevel === WP.levelFromPlus(6) && sword.weaponLevel === 37 && sword.stars === 1 && bag.equipped.weapon === "espada_latao");
    const legacy = (await pool.query(`SELECT legacy, rules FROM tb_mm_gear_instance WHERE id_instance=$1`, [sword.id])).rows[0];
    check("conversão: o retrato de antes fica guardado (plus 6, forge-v2) e a regra vira weapon-v1", legacy.rules === "weapon-v1" && legacy.legacy.plus === 6 && legacy.legacy.rules === "forge-v2");
    const owned = bag.owned;
    check("aposentados viraram pó novo (7 Pedras → 7 D; 25 Pós de Refino → 3 D; 2 Catalisadores → 2 SS)",
      owned.po_ref_d?.qty === 10 && owned.po_ref_ss?.qty === 2 && !owned.pedra_aprimoramento && !owned.po_refino && !owned.catalisador_refino);
    check("Criogenia e materiais de Domínio ficam como estavam", owned.embriao_kragor?.qty === 1 && owned.po_de_lua?.qty === 9);
    const ledger = (await pool.query(`SELECT item_id, delta FROM tb_mm_item_ledger WHERE id_user=$1 AND item_id IN ('pedra_aprimoramento','po_ref_d')`, [id])).rows;
    check("a conversão passa pelo livro (sai a Pedra, entra o pó)", ledger.some((r) => r.item_id === "pedra_aprimoramento" && Number(r.delta) === -7) && ledger.some((r) => r.item_id === "po_ref_d" && Number(r.delta) > 0));
    const again = (await Service.get(id)).bag;
    check("conversão é uma vez só (abrir de novo não muda nada)", again.owned.po_ref_d.qty === 10 && again.instances.find((x) => x.id === sword.id).weaponLevel === 37);

    // ── refino: nível 37 → 38 usa pó A (faixa 31–40), chance 80%
    const view = again.forge[sword.id].refine;
    check("bancada mostra a próxima tentativa (37→38, pó A, 80%) e o bônus antes/depois", view.from === 37 && view.to === 38 && view.powder === "po_ref_a" && view.chance === 0.8 && view.bonusAfter.dmg > view.bonusBefore.dmg);
    check("sem pó A a tentativa é recusada sem gastar nada", (await Service.refineWeapon(id, { instance: sword.id, key: key() })).code === "needs");
    await pool.query(`INSERT INTO tb_mm_gear (id_user,item_id,qty) VALUES ($1,'po_ref_a',5)`, [id]);

    Service.R = () => 0.5; // < 0,8 → sobe
    const okReq = { instance: sword.id, key: key(), rulesVersion: "weapon-v1" };
    const [r1, r2] = await Promise.all([Service.refineWeapon(id, okReq), Service.refineWeapon(id, okReq)]);
    let row = (await pool.query(`SELECT weapon_level, version FROM tb_mm_gear_instance WHERE id_instance=$1`, [sword.id])).rows[0];
    check("sucesso: sobe 1 nível; duas abas com a mesma chave = o mesmo recibo e 1 pó gasto",
      r1.receipt.eventId === r2.receipt.eventId && r1.receipt.result.success === true && row.weapon_level === 38 && r1.bag.owned.po_ref_a.qty === 4);
    check("o recibo guarda o sorteio, a chance e o pó", r1.receipt.result.roll === 0.5 && r1.receipt.result.chance === 0.8 && r1.receipt.result.powder === "po_ref_a");
    Service.R = () => 0.99;
    const replay = await Service.refineWeapon(id, okReq);
    check("reenvio da mesma chave devolve o MESMO resultado (não ressorteia)", replay.replay === true && replay.receipt.result.success === true);
    const starter = (await Service.get(id)).bag.instances.find((x) => x.item !== "espada_latao");
    const conflict = await Service.refineWeapon(id, { ...okReq, instance: starter ? starter.id : key() });
    check("a mesma chave noutra cópia é recusada", ["key_conflict", "instance"].includes(conflict.code));

    Service.R = () => 0.95; // ≥ 0,8 → falha
    const fail1 = await Service.refineWeapon(id, { instance: sword.id, key: key() });
    row = (await pool.query(`SELECT weapon_level, version FROM tb_mm_gear_instance WHERE id_instance=$1`, [sword.id])).rows[0];
    check("falha: gasta o pó, o nível fica (nunca desce) e a versão anda", fail1.receipt.result.success === false && row.weapon_level === 38 && fail1.bag.owned.po_ref_a.qty === 3);
    check("versão velha (outra aba) é recusada", (await Service.refineWeapon(id, { instance: sword.id, key: key(), version: Number(row.version) - 1 })).code === "version");
    check("regra velha do aparelho dá 410 (atualize)", (await Service.refineWeapon(id, { instance: sword.id, key: key(), rulesVersion: "forge-v2" })).statusCode === 410);
    check("cópia de outra conta não existe para mim", (await Service.refineWeapon(other, { instance: sword.id, key: key() })).code === "instance");

    // duas abas, chaves diferentes, 1 pó só: uma tenta, a outra fica sem pó
    await pool.query(`UPDATE tb_mm_gear SET qty=1 WHERE id_user=$1 AND item_id='po_ref_a'`, [id]);
    Service.R = () => 0;
    const [c1, c2] = await Promise.all([Service.refineWeapon(id, { instance: sword.id, key: key() }), Service.refineWeapon(id, { instance: sword.id, key: key() })]);
    row = (await pool.query(`SELECT weapon_level FROM tb_mm_gear_instance WHERE id_instance=$1`, [sword.id])).rows[0];
    check("concorrência: um pó = uma tentativa (a outra aba recebe 'needs')", [c1, c2].filter((r) => r.receipt).length === 1 && [c1, c2].some((r) => r.code === "needs") && row.weapon_level === 39);

    // teto
    await pool.query(`UPDATE tb_mm_gear_instance SET weapon_level=90 WHERE id_instance=$1`, [sword.id]);
    await pool.query(`INSERT INTO tb_mm_gear (id_user,item_id,qty) VALUES ($1,'po_ref_sss3',3)`, [id]);
    check("no nível 90 não refina mais (e não gasta pó)", (await Service.refineWeapon(id, { instance: sword.id, key: key() })).code === "max" && (await Service.get(id)).bag.owned.po_ref_sss3.qty === 3);

    // ── montagem por fragmento de classe: a pessoa escolhe a arma da classe
    await pool.query(`INSERT INTO tb_mm_gear (id_user,item_id,qty) VALUES ($1,'frag_classe_d',85)`, [id]);
    const weaponD = "espada_latao"; // classe D (a mesma que já tem: repetida vale)
    assert.equal(WP.assemblyCost(Items.GEAR_BY_ID.get(weaponD)).fragment, "frag_classe_d");
    const asmReq = { item: weaponD, key: key() };
    const [a1, a2] = await Promise.all([Service.assembleWeapon(id, asmReq), Service.assembleWeapon(id, asmReq)]);
    bag = a1.bag;
    const copies = bag.instances.filter((x) => x.item === weaponD);
    check("montar: 40 fragmentos D (classe D = 40) viram UMA cópia nova (nível 1, 1 estrela), mesmo com reenvio",
      a1.receipt.eventId === a2.receipt.eventId && copies.length === 2 && bag.owned.frag_classe_d.qty === 45 && copies.some((x) => x.weaponLevel === 1 && x.stars === 1));
    check("a cópia montada não é vestida sozinha", bag.equipped.weapon === "espada_latao" && copies.filter((x) => x.equippedBy).length === 1);
    check("mesma chave com outra arma é recusada", (await Service.assembleWeapon(id, { item: "cajado_latao", key: asmReq.key })).code === "key_conflict");
    const a3 = await Service.assembleWeapon(id, { item: weaponD, key: key() });
    check("segunda cópia (repetida) também monta", a3.bag.instances.filter((x) => x.item === weaponD).length === 3 && a3.bag.owned.frag_classe_d.qty === 5);
    check("sem 40 fragmentos recusa sem gastar", (await Service.assembleWeapon(id, { item: weaponD, key: key() })).code === "fragments" && (await Service.get(id)).bag.owned.frag_classe_d.qty === 5);
    check("não monta o que não é arma", (await Service.assembleWeapon(id, { item: "colete_couro", key: key() })).code === "item");

    // ── estrelas: consome uma cópia idêntica nova
    bag = (await Service.get(id)).bag;
    const fresh = bag.instances.filter((x) => x.item === weaponD && x.id !== sword.id);
    const starView = bag.forge[sword.id].stars;
    check("forja mostra a próxima estrela e as doadoras possíveis", starView.from === 1 && starView.to === 2 && fresh.every((x) => starView.donors.includes(x.id)));
    const stReq = { instance: sword.id, donor: fresh[0].id, key: key() };
    const [s1, s2] = await Promise.all([Service.starWeapon(id, stReq), Service.starWeapon(id, stReq)]);
    bag = s1.bag;
    check("estrela: +1 garantido, a doadora some uma vez só", s1.receipt.eventId === s2.receipt.eventId && bag.instances.find((x) => x.id === sword.id).stars === 2 && !bag.instances.some((x) => x.id === fresh[0].id));
    check("a mesma chave com outra doadora é recusada", (await Service.starWeapon(id, { ...stReq, donor: fresh[1].id })).code === "key_conflict");
    check("a própria cópia não doa", (await Service.starWeapon(id, { instance: sword.id, donor: sword.id, key: key() })).code === "donorself");
    await pool.query(`UPDATE tb_mm_gear_instance SET weapon_level=2 WHERE id_instance=$1`, [fresh[1].id]);
    check("doadora com nível > 1 é recusada (sem perder nada)", (await Service.starWeapon(id, { instance: sword.id, donor: fresh[1].id, key: key() })).code === "donorbuilt" && (await Service.get(id)).bag.instances.some((x) => x.id === fresh[1].id));
    await pool.query(`UPDATE tb_mm_gear_instance SET weapon_level=1, locked=true WHERE id_instance=$1`, [fresh[1].id]);
    check("doadora travada é recusada", (await Service.starWeapon(id, { instance: sword.id, donor: fresh[1].id, key: key() })).code === "pinned");
    await pool.query(`UPDATE tb_mm_gear_instance SET locked=false WHERE id_instance=$1`, [fresh[1].id]);
    await Service.equip(id, { slot: "weapon", item: weaponD, instance: fresh[1].id });
    check("doadora vestida é recusada", (await Service.starWeapon(id, { instance: sword.id, donor: fresh[1].id, key: key() })).code === "worn");
    await Service.equip(id, { slot: "weapon", item: weaponD, instance: sword.id });
    if (starter) check("doadora de outra arma é recusada", (await Service.starWeapon(id, { instance: sword.id, donor: starter.id, key: key() })).code === "donoritem");
    await pool.query(`UPDATE tb_mm_gear_instance SET grade=5 WHERE id_instance=$1`, [sword.id]);
    check("5 estrelas é o teto", (await Service.starWeapon(id, { instance: sword.id, donor: fresh[1].id, key: key() })).code === "max");

    // ── poder: o nível e as estrelas entram na régua da luta
    const fight = async () => { const c = await pool.connect(); try { return await Service.fightGear(c, id, "vampiro"); } finally { c.release(); } };
    await pool.query(`UPDATE tb_mm_gear_instance SET weapon_level=1, grade=1 WHERE id_instance=$1`, [sword.id]);
    const gLow = await fight();
    await pool.query(`UPDATE tb_mm_gear_instance SET weapon_level=90, grade=5 WHERE id_instance=$1`, [sword.id]);
    const gHigh = await fight();
    check("luta: nível 90 / 5 estrelas dá mais dano que nível 1 / 1 estrela", gHigh.dmg > gLow.dmg);

    // ── o que saiu responde 410
    for (const m of ["upgrade", "grade", "salvage", "transmute", "socket", "unsocket", "fuseRunes", "ascend", "awaken", "enchant", "enchantResolve", "convertFragments", "refine", "resolveRefine"]) {
      assert.equal((await Service[m](id, { item: "espada_latao", instance: sword.id, key: key() })).statusCode, 410, m);
    }
    check("aprimorar, graus, runas, Ascensão, Despertar, encanto, desmontar, transmutar e o refino antigo dão 410", true);
    console.log(`\n${checks} verificações de integração passaram.`);
  } finally {
    Service.R = originalR;
    await pool.end();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
