// Integração real do refino/forja das ARMAS (weapon-v2, 24/11/2026). EXCLUSIVAMENTE banco local descartável.
// TEST_DATABASE_URL=postgres://postgres:<senha>@127.0.0.1:55432/mm_refine_test node test/meu-mundo-refino.e2e.js
//
// Cobre: conversão sem perda (+N → nível, grau → estrelas, pilha aposentada → pó/fragmento novo, pó SSS → pó da
// classe), refino por barra de XP com o pó da CLASSE (tentativa esperando decisão, aceitar/recusar, perda que
// nunca desce de nível, sobra que passa de nível, 10 vezes aceitando só o que sobe, teto, mesma chave, duas abas,
// versão velha, regra velha), estrelas
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
    if (file.startsWith("323_") || file.startsWith("466_") || file.startsWith("467_")) await pool.query(sql); // idempotente
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
    // 24/11/2026 (tudo por fragmento): o material do Domínio vira o fragmento do preparo (Pó de Lua → Colírio de Mira, 1:1)
    check("Criogenia fica; o Pó de Lua vira 9 fragmentos do Colírio de Mira", owned.embriao_kragor?.qty === 1 && !owned.po_de_lua && owned.frag_colirio_mira?.qty === 9);
    const ledger = (await pool.query(`SELECT item_id, delta FROM tb_mm_item_ledger WHERE id_user=$1 AND item_id IN ('pedra_aprimoramento','po_ref_d')`, [id])).rows;
    check("a conversão passa pelo livro (sai a Pedra, entra o pó)", ledger.some((r) => r.item_id === "pedra_aprimoramento" && Number(r.delta) === -7) && ledger.some((r) => r.item_id === "po_ref_d" && Number(r.delta) > 0));
    const again = (await Service.get(id)).bag;
    check("conversão é uma vez só (abrir de novo não muda nada)", again.owned.po_ref_d.qty === 10 && again.instances.find((x) => x.id === sword.id).weaponLevel === 37);

    // ── refino weapon-v2: a espada de latão é classe D → só o pó D refina; barra de XP do nível 37
    const view = again.forge[sword.id].refine;
    check("bancada mostra o pó da CLASSE (D), a barra do nível e o bônus do próximo",
      view.level === 37 && view.xp === 0 && view.need === WP.xpNeed(37) && view.powder === "po_ref_d" && view.pending === null && view.bonusAfter.dmg > view.bonusBefore.dmg);
    await pool.query(`UPDATE tb_mm_gear SET qty=0 WHERE id_user=$1 AND item_id='po_ref_d'`, [id]);
    await pool.query(`INSERT INTO tb_mm_gear (id_user,item_id,qty) VALUES ($1,'po_ref_a',50)`, [id]);
    check("pó de outra classe não serve: sem pó D a tentativa é recusada sem gastar nada",
      (await Service.refineWeapon(id, { instance: sword.id, key: key() })).code === "powder" && (await Service.get(id)).bag.owned.po_ref_a.qty === 50);
    await pool.query(`UPDATE tb_mm_gear SET qty=30 WHERE id_user=$1 AND item_id='po_ref_d'`, [id]);

    // sorteio fixo: o 1º número escolhe a faixa, o 2º o valor (0,8 / 0,5 → "good" +90; 0 / 0 → "loss" −40; 0,15 / 0 → +20)
    const seq = (...xs) => { let i = 0; return () => xs[i++ % xs.length]; };
    const prog = async () => (await pool.query(`SELECT weapon_level, weapon_xp, weapon_pending, version FROM tb_mm_gear_instance WHERE id_instance=$1`, [sword.id])).rows[0];
    const powderD = async () => (await Service.get(id)).bag.owned.po_ref_d?.qty || 0;
    Service.R = seq(0.8, 0.5);
    const okReq = { instance: sword.id, key: key(), rulesVersion: WP.RULES_VERSION };
    const [r1, r2] = await Promise.all([Service.refineWeapon(id, okReq), Service.refineWeapon(id, okReq)]);
    let row = await prog();
    check("tentativa: gasta 1 pó D, sorteia +90 e ESPERA a decisão (nível e barra ainda iguais); duas abas, mesma chave = um recibo",
      r1.receipt.eventId === r2.receipt.eventId && r1.receipt.result.pending === true && r1.receipt.result.rolls[0].xp === 90 && r1.receipt.result.rolls[0].tier === "good" &&
      row.weapon_level === 37 && row.weapon_xp === 0 && row.weapon_pending.xp === 90 && r1.bag.owned.po_ref_d.qty === 29);
    check("a tela vê o resultado esperando", r1.bag.forge[sword.id].refine.pending.xp === 90 && r1.bag.instances.find((x) => x.id === sword.id).weaponPending.xp === 90);
    Service.R = () => 0.99;
    const replay = await Service.refineWeapon(id, okReq);
    check("reenvio da mesma chave devolve o MESMO sorteio (não ressorteia)", replay.replay === true && replay.receipt.result.rolls[0].xp === 90);
    check("a mesma chave com 10 vezes é recusada", (await Service.refineWeapon(id, { ...okReq, times: 10 })).code === "key_conflict");
    const starter = (await Service.get(id)).bag.instances.find((x) => x.item !== "espada_latao");
    const conflict = await Service.refineWeapon(id, { ...okReq, instance: starter ? starter.id : key() });
    check("a mesma chave noutra cópia é recusada", ["key_conflict", "instance"].includes(conflict.code));
    check("com resultado esperando não refina de novo (nem 10 vezes) e não gasta pó",
      (await Service.refineWeapon(id, { instance: sword.id, key: key() })).code === "pending" && (await Service.refineWeapon(id, { instance: sword.id, key: key(), times: 10 })).code === "pending" && (await powderD()) === 29);
    const acc = { instance: sword.id, key: key(), decision: "accept" };
    const [d1, d2] = await Promise.all([Service.decideWeapon(id, acc), Service.decideWeapon(id, acc)]);
    row = await prog();
    check("aceitar soma o XP uma vez só (duas abas, mesma chave)", d1.receipt.eventId === d2.receipt.eventId && d1.receipt.result.xp === 90 && row.weapon_level === 37 && row.weapon_xp === 90 && row.weapon_pending === null);
    check("decidir sem nada esperando dá 'nopending'", (await Service.decideWeapon(id, { instance: sword.id, key: key(), decision: "accept" })).code === "nopending");
    check("decisão inválida é recusada", (await Service.decideWeapon(id, { instance: sword.id, key: key(), decision: "talvez" })).code === "decision");

    // perda + recusar: o XP sorteado some, o pó já foi
    Service.R = seq(0, 0);
    const lossTry = await Service.refineWeapon(id, { instance: sword.id, key: key() });
    check("o sorteio pode TIRAR XP (−40)", lossTry.receipt.result.rolls[0].xp === -40 && lossTry.receipt.result.rolls[0].tier === "loss");
    await Service.decideWeapon(id, { instance: sword.id, key: key(), decision: "reject" });
    row = await prog();
    check("recusar descarta: a barra fica em 90 e o pó foi gasto (28)", row.weapon_xp === 90 && row.weapon_pending === null && (await powderD()) === 28);
    // aceitar a perda tira XP, mas nunca desce de nível
    await Service.refineWeapon(id, { instance: sword.id, key: key() });
    await Service.decideWeapon(id, { instance: sword.id, key: key(), decision: "accept" });
    row = await prog();
    check("aceitar a perda: 90 − 40 = 50", row.weapon_level === 37 && row.weapon_xp === 50);
    await pool.query(`UPDATE tb_mm_gear_instance SET weapon_xp=10 WHERE id_instance=$1`, [sword.id]);
    await Service.refineWeapon(id, { instance: sword.id, key: key() });
    await Service.decideWeapon(id, { instance: sword.id, key: key(), decision: "accept" });
    row = await prog();
    check("perda maior que a barra para no começo dela (nunca desce de nível)", row.weapon_level === 37 && row.weapon_xp === 0);
    // sobra passa de nível
    await pool.query(`UPDATE tb_mm_gear_instance SET weapon_xp=$2 WHERE id_instance=$1`, [sword.id, WP.xpNeed(37) - 5]);
    Service.R = seq(0.15, 0);
    await Service.refineWeapon(id, { instance: sword.id, key: key() });
    const up = await Service.decideWeapon(id, { instance: sword.id, key: key(), decision: "accept" });
    row = await prog();
    check("a sobra passa de nível (+20 com 5 faltando → nível 38 com 15)", row.weapon_level === 38 && row.weapon_xp === 15 && up.receipt.result.up === 1 && up.bag.forge[sword.id].refine.need === WP.xpNeed(38));

    // 10 vezes: aceita sozinho o que sobe
    let before = await powderD();
    Service.R = seq(0, 0, 0.8, 0.5); // −40, +90, −40, +90…
    const ten = await Service.refineWeapon(id, { instance: sword.id, key: key(), times: 10 });
    row = await prog();
    const rolls = ten.receipt.result.rolls;
    check("10 vezes: 10 tentativas, aceita só as +90 (5), recusa as −40, nada fica esperando",
      rolls.length === 10 && rolls.filter((x) => x.accepted).length === 5 && rolls.every((x) => x.accepted === x.xp > 0) && row.weapon_level === 38 && row.weapon_xp === 15 + 450 && row.weapon_pending === null && (await powderD()) === before - 10);
    await pool.query(`UPDATE tb_mm_gear SET qty=3 WHERE id_user=$1 AND item_id='po_ref_d'`, [id]);
    const short = await Service.refineWeapon(id, { instance: sword.id, key: key(), times: 10 });
    check("10 vezes para quando o pó acaba (3 pós = 3 tentativas)", short.receipt.result.rolls.length === 3 && short.receipt.result.used === 3 && (await powderD()) === 0);
    check("sem pó: nem 1 nem 10 vezes", (await Service.refineWeapon(id, { instance: sword.id, key: key(), times: 10 })).code === "powder" && (await Service.refineWeapon(id, { instance: sword.id, key: key() })).code === "powder");
    check("quantidade inválida (3 vezes) é recusada", (await Service.refineWeapon(id, { instance: sword.id, key: key(), times: 3 })).code === "times");

    await pool.query(`UPDATE tb_mm_gear SET qty=20 WHERE id_user=$1 AND item_id='po_ref_d'`, [id]);
    row = await prog();
    check("versão velha (outra aba) é recusada", (await Service.refineWeapon(id, { instance: sword.id, key: key(), version: Number(row.version) - 1 })).code === "version");
    check("regra velha do aparelho (weapon-v1) dá 410 (atualize)", (await Service.refineWeapon(id, { instance: sword.id, key: key(), rulesVersion: "weapon-v1" })).statusCode === 410);
    check("cópia de outra conta não existe para mim", (await Service.refineWeapon(other, { instance: sword.id, key: key() })).code === "instance" && (await Service.decideWeapon(other, { instance: sword.id, key: key(), decision: "accept" })).code === "instance");

    // duas abas, chaves diferentes: a primeira deixa o resultado esperando, a segunda não refina por cima
    Service.R = seq(0.15, 0);
    const [c1, c2] = await Promise.all([Service.refineWeapon(id, { instance: sword.id, key: key() }), Service.refineWeapon(id, { instance: sword.id, key: key() })]);
    check("concorrência: uma tentativa só; a outra aba recebe 'pending'", [c1, c2].filter((r) => r.receipt).length === 1 && [c1, c2].some((r) => r.code === "pending") && (await powderD()) === 19);
    await Service.decideWeapon(id, { instance: sword.id, key: key(), decision: "reject" });

    // teto
    await pool.query(`UPDATE tb_mm_gear_instance SET weapon_level=90, weapon_xp=0 WHERE id_instance=$1`, [sword.id]);
    check("no nível 90 não refina mais (e não gasta pó)", (await Service.refineWeapon(id, { instance: sword.id, key: key() })).code === "max" && (await powderD()) === 19);

    // pós da weapon-v1: SSS I/II/III viram SSR/Lendária/Divina, 1:1, pelo livro
    await pool.query(`INSERT INTO tb_mm_gear (id_user,item_id,qty) VALUES ($1,'po_ref_sss1',2),($1,'po_ref_sss2',7),($1,'po_ref_sss3',1)`, [id]);
    const conv = (await Service.get(id)).bag.owned;
    check("pó SSS I/II/III virou SSR 2 / Lendária 7 / Divina 1 (ninguém perde)",
      conv.po_ref_ssr?.qty === 2 && conv.po_ref_legendary?.qty === 7 && conv.po_ref_divine?.qty === 1 && !conv.po_ref_sss1 && !conv.po_ref_sss2 && !conv.po_ref_sss3);

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
    await pool.query(`UPDATE tb_mm_gear_instance SET weapon_level=1, weapon_xp=5 WHERE id_instance=$1`, [fresh[1].id]);
    check("doadora com XP na barra é recusada", (await Service.starWeapon(id, { instance: sword.id, donor: fresh[1].id, key: key() })).code === "donorbuilt");
    await pool.query(`UPDATE tb_mm_gear_instance SET weapon_xp=0, weapon_pending='{"xp":30}'::jsonb WHERE id_instance=$1`, [fresh[1].id]);
    check("doadora com refino esperando decisão é recusada", (await Service.starWeapon(id, { instance: sword.id, donor: fresh[1].id, key: key() })).code === "donorbuilt");
    await pool.query(`UPDATE tb_mm_gear_instance SET weapon_pending=NULL, locked=true WHERE id_instance=$1`, [fresh[1].id]);
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
