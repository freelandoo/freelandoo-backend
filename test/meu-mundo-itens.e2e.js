// Trilha E, fatia E2 (mig 446): instâncias de equipamento, loadout por personagem e livro de itens.
// EXCLUSIVAMENTE banco local descartável:
// TEST_DATABASE_URL=postgres://postgres:<senha>@127.0.0.1:55432/mm_itens_test node test/meu-mundo-itens.e2e.js
const target = process.env.TEST_DATABASE_URL;
let parsed;
try { parsed = new URL(target); } catch { /* guard below */ }
if (!parsed || !["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/mm_itens_test") {
  console.error("Use somente TEST_DATABASE_URL local com banco descartável mm_itens_test.");
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
    if (file.startsWith("446_")) await pool.query(sql); // idempotente
  }
}

async function main() {
  const pool = require("../src/databases");
  const Service = require("../src/services/MeuMundoGearService");
  const Store = require("../src/storages/MeuMundoGearStorage");
  const Life = require("../src/services/MeuMundoLifeService");
  const Gear = require("../src/utils/meuMundoGear");
  Life.adminPerks = false;
  try {
    await bootstrap(pool);
    const id = key(), stranger = key();
    for (const user of [id, stranger]) {
      await pool.query(`INSERT INTO tb_user VALUES ($1, 'itens', 'itens@mm.test')`, [user]);
      await Life.peek(user);
      await pool.query(`INSERT INTO tb_mm_clan (id_user, clan, sex) VALUES ($1, 'vampiro', 'm')`, [user]);
      await pool.query(`INSERT INTO tb_mm_char_adventure (id_character, id_user, xp) SELECT id_character, $1, 500000 FROM tb_mm_character WHERE id_user = $1 AND status = 'alive'`, [user]);
      await pool.query(`INSERT INTO emerald_wallets (user_id, balance) VALUES ($1, 500000) ON CONFLICT (user_id) DO UPDATE SET balance = 500000`, [user]);
    }

    // ── conta "antiga": pilha e equipado de antes da E2 ──
    await pool.query(`INSERT INTO tb_mm_gear (id_user,item_id,qty,level) VALUES
      ($1,'espada_latao',1,4), ($1,'espada_aprendiz',1,0), ($1,'fragmento_lamina',37,0), ($1,'nucleo_eter',5,0), ($1,'selo_forja',3,0)`, [id]);
    const acc = Gear.GEAR.find((g) => g.category === "accessory" && !g.clan);
    const armor = Gear.GEAR.find((g) => g.category === "armor" && !g.clan);
    await pool.query(`INSERT INTO tb_mm_gear (id_user,item_id,qty,level) VALUES ($1,$2,1,0), ($1,$3,1,2)`, [id, acc.id, armor.id]);
    await pool.query(`INSERT INTO tb_mm_equip (id_user,slot,item_id) VALUES ($1,'weapon','espada_latao'), ($1,'acc1',$2), ($1,'armor',$3)`, [id, acc.id, armor.id]);
    const legacyRows = Number((await pool.query(`SELECT COUNT(*) FROM tb_mm_gear WHERE id_user=$1 AND qty>0 AND item_id = ANY($2::text[])`,
      [id, Gear.GEAR.filter(Service.isInstanceItem).map((g) => g.id)])).rows[0].count);
    // bônus de antes, pela regra pura e pelo tb_mm_equip
    const bonusBefore = Gear.gearBonus({ weapon: { id: "espada_latao", level: 4 }, acc1: { id: acc.id, level: 0 }, armor: { id: armor.id, level: 2 } });
    const clan = "vampiro";

    const c = await pool.connect();
    let bonusAfter, moved2;
    try {
      await c.query("BEGIN");
      await Service.prepare(c, id);
      moved2 = await Service.prepare(c, id);
      bonusAfter = await Service.fightGear(c, id, clan);
      await c.query("COMMIT");
    } finally { c.release(); }
    const inst = async (u = id) => (await pool.query(`SELECT * FROM tb_mm_gear_instance WHERE id_user=$1 ORDER BY item_id, plus`, [u])).rows;
    check("materialize: uma instância por linha de equipamento com qty > 0", (await inst()).length === legacyRows && legacyRows === 4);
    check("materialize duas vezes não duplica", moved2 === 0 && (await inst()).length === legacyRows);
    check("level vira plus", (await inst()).find((x) => x.item_id === "espada_latao").plus === 4 && (await inst()).find((x) => x.item_id === armor.id).plus === 2);
    check("pilha antiga de equipamento zerada; material segue em pilha", Number((await pool.query(`SELECT qty FROM tb_mm_gear WHERE id_user=$1 AND item_id='espada_latao'`, [id])).rows[0].qty) === 0
      && Number((await pool.query(`SELECT qty FROM tb_mm_gear WHERE id_user=$1 AND item_id='fragmento_lamina'`, [id])).rows[0].qty) === 37);
    check("bônus da luta igual antes e depois", JSON.stringify(bonusAfter) === JSON.stringify(bonusBefore));
    const live = (await pool.query(`SELECT id_character FROM tb_mm_character WHERE id_user=$1 AND status='alive'`, [id])).rows[0].id_character;
    const lo = await Store.loadout(pool, live);
    // E6: e já nos 8 slots (acc1 → slot da peça, armor → chest)
    check("tb_mm_equip copiado para o loadout do personagem vivo", Object.keys(lo).sort().join() === [acc.slot, "chest", "weapon"].sort().join());

    // ── livro: soma dos delta = qty da pilha ──
    const ledgerOk = async () => {
      const r = await pool.query(`SELECT g.item_id, g.qty, COALESCE((SELECT SUM(delta) FROM tb_mm_item_ledger l WHERE l.id_user=g.id_user AND l.item_id=g.item_id),0)::int AS sum
        FROM tb_mm_gear g WHERE g.id_user=$1 AND NOT (g.item_id = ANY($2::text[]))`, [id, Gear.GEAR.filter(Service.isInstanceItem).map((g) => g.id)]);
      return r.rows.every((x) => x.qty === x.sum);
    };
    check("livro abre com o saldo da pilha", await ledgerOk());

    // ── duas espadas iguais com plus diferente ──
    const c2 = await pool.connect();
    let second;
    try {
      second = await Store.createInstance(c2, id, "espada_latao", "teste");
      await Store.setPlus(c2, id, second, 7);
    } finally { c2.release(); }
    const bag1 = (await Service.get(id)).bag;
    const swords = bag1.instances.filter((x) => x.item === "espada_latao");
    check("duas espadas iguais com plus diferente", swords.length === 2 && swords.map((x) => x.plus).sort().join() === "4,7");
    check("representante é a equipada (não a de maior plus)", bag1.owned.espada_latao.level === 4 && bag1.owned.espada_latao.qty === 2 && swords.find((x) => x.plus === 4).equippedHere);
    check("cada instância tem a sua prévia de refino", bag1.refinementInstances[second].standard.toMax === undefined || bag1.refinementInstances[second].standard.item === "espada_latao");
    const eq2 = await Service.equip(id, { slot: "weapon", item: "espada_latao", instance: second });
    check("equipar escolhe a cópia", eq2.bag.equippedInstances.weapon === second && eq2.bag.owned.espada_latao.level === 7);
    const c3 = await pool.connect();
    try { check("a luta usa o plus da cópia equipada", (await Service.fightGear(c3, id, clan)).dmg === Gear.gearBonus({ weapon: { id: "espada_latao", level: 7 }, acc1: { id: acc.id, level: 0 }, armor: { id: armor.id, level: 2 } }).dmg); } finally { c3.release(); }

    // ── mesma chave duas vezes cobra uma ──
    const buyable = Gear.GEAR_BY_ID.get("espada_aco");
    const coins0 = (await Service.get(id)).bag.coins;
    const k = key();
    const [b1, b2] = await Promise.all([Service.buy(id, { item: buyable.id, key: k }), Service.buy(id, { item: buyable.id, key: k })]);
    const coins1 = (await Service.get(id)).bag.coins;
    check("mesma chave duas vezes cobra uma", b1.receipt.eventId === b2.receipt.eventId && coins1 === coins0 - buyable.price
      && (await inst()).filter((x) => x.item_id === buyable.id).length === 1);
    check("compra de equipamento nasce instância +0", b1.receipt.result.instance && (await inst()).find((x) => x.item_id === buyable.id).plus === 0);

    // ── instância de outra conta dá 404 ──
    const strangerInst = await Store.createInstance(pool, stranger, "espada_latao", "teste");
    const steal = await Service.equip(id, { slot: "weapon", item: "espada_latao", instance: strangerInst });
    check("instância de outra conta dá 404 (equipar)", steal.code === "instance" && steal.statusCode === 404);
    const stealR = await Service.refine(id, { item: "espada_latao", instance: strangerInst, key: key(), quote: "x" });
    check("instância de outra conta dá 404 (refinar)", stealR.code === "instance" && stealR.statusCode === 404);
    const stealX = await Service.recycle(id, { item: "espada_latao", instance: strangerInst, key: key() });
    check("instância de outra conta dá 404 (reciclar)", stealX.code === "instance");

    // ── refino por instância ──
    Service.R = () => 0.0; // sobe
    const q = (await Service.get(id)).bag.refinementInstances[second].standard;
    const ref = await Service.refine(id, { item: "espada_latao", instance: second, key: key(), quote: q.id });
    check("refino aponta a instância", ref.proposal && ref.proposal.instance === second && ref.proposal.fromLevel === 7);
    const ok = await Service.resolveRefine(id, { proposalId: ref.proposal.id, accept: true, key: key() });
    const after = await inst();
    check("aceite muda só a cópia refinada", ok.proposal.status === "accepted" && after.find((x) => x.id_instance === second).plus === 8
      && after.filter((x) => x.item_id === "espada_latao" && x.id_instance !== second).every((x) => x.plus === 4));
    check("livro fecha depois do refino e da compra", await ledgerOk());
    const linked = Number((await pool.query(`SELECT COUNT(*) FROM tb_mm_item_ledger WHERE id_user=$1 AND id_receipt IS NOT NULL`, [id])).rows[0].count);
    check("linhas do livro das operações levam o recibo", linked >= 2);

    // ── reciclar: só cópia solta ──
    const free = (await inst()).find((x) => x.item_id === "espada_latao" && x.id_instance !== second);
    const rec = await Service.recycle(id, { item: "espada_latao", instance: free.id_instance, key: key() });
    check("recicla a cópia solta", rec.receipt && (await inst()).filter((x) => x.item_id === "espada_latao").length === 1);
    const busy = await Service.recycle(id, { item: "espada_latao", key: key() });
    check("cópia equipada não recicla", busy.code === "equipped");

    // ── personagem novo não herda o loadout do outro ──
    await pool.query(`UPDATE tb_mm_character SET status='capsule' WHERE id_character=$1`, [live]);
    // personagem B = cópia do A com id novo, vivo (A foi para a cápsula)
    const other = (await pool.query(`INSERT INTO tb_mm_character
      SELECT (jsonb_populate_record(NULL::tb_mm_character, to_jsonb(ch) || jsonb_build_object('id_character', gen_random_uuid(), 'generation', ch.generation + 1, 'status', 'alive', 'born_at', NOW(), 'serial', nextval('seq_mm_character_serial'), 'cert_code', 'E2-' || substr(md5(random()::text), 1, 10)))).*
        FROM tb_mm_character ch WHERE id_character=$1 RETURNING id_character`, [live])).rows[0].id_character;
    await pool.query(`INSERT INTO tb_mm_char_adventure (id_character, id_user, xp) VALUES ($1, $2, 500000)`, [other, id]); // nível é do personagem (mig 435)
    const bagB = (await Service.get(id)).bag;
    check("personagem B começa sem equipado; a cópia de A segue com A", !bagB.equipped.weapon && bagB.instances.find((x) => x.id === second).equippedBy === live);
    const eqB = await Service.equip(id, { slot: "weapon", item: "espada_latao", instance: second });
    check("B pega a cópia: ela sai do A", eqB.bag.equippedInstances.weapon === second && Object.keys(await Store.loadout(pool, live)).indexOf("weapon") === -1);
    assert.ok(other);

    // ══ E6: 8 slots, duas mãos, loadout antigo levado para os slots novos ══
    const h = key();
    await pool.query(`INSERT INTO tb_user VALUES ($1, 'h', 'h@mm.test')`, [h]);
    await Life.peek(h);
    await pool.query(`INSERT INTO tb_mm_clan (id_user, clan, sex) VALUES ($1, 'vampiro', 'm')`, [h]);
    await pool.query(`UPDATE tb_mm_character SET species = 'kragor' WHERE id_user = $1 AND status = 'alive'`, [h]); // usa arma pesada
    await pool.query(`INSERT INTO tb_mm_char_adventure (id_character, id_user, xp) SELECT id_character, $1, 500000 FROM tb_mm_character WHERE id_user = $1 AND status = 'alive'`, [h]);
    // conta antiga: espada + escudo + luvas (acc1) + relógio (acc2) + colete (armor)
    await pool.query(`INSERT INTO tb_mm_gear (id_user,item_id,qty,level) VALUES ($1,'pesada_ferreiro',1,0),($1,'escudo_ferro',1,0),($1,'luvas_precisao',1,0),($1,'relogio_bolso',1,0),($1,'colete_couro',1,0),($1,'medalhao_lunar',1,0)`, [h]);
    await pool.query(`INSERT INTO tb_mm_equip (id_user,slot,item_id) VALUES ($1,'shield','escudo_ferro'),($1,'acc1','luvas_precisao'),($1,'acc2','relogio_bolso'),($1,'armor','colete_couro')`, [h]);
    const bonusOld = Gear.gearBonus({ acc1: { id: "luvas_precisao", level: 0 }, acc2: { id: "relogio_bolso", level: 0 }, armor: { id: "colete_couro", level: 0 } });
    const bagH = (await Service.get(h)).bag;
    check("E6: slots antigos viram os 8 (acc1 luvas → gloves, acc2 relógio → amulet, armor → chest, shield → offhand)",
      bagH.equipped.gloves === "luvas_precisao" && bagH.equipped.amulet === "relogio_bolso" && bagH.equipped.chest === "colete_couro" && bagH.equipped.offhand === "escudo_ferro" && !bagH.equipped.acc1 && !bagH.equipped.shield);
    check("E6: bônus total igual só pela troca de slots (escudo não vale para quem usa pesada)", JSON.stringify(bagH.bonus) === JSON.stringify(bonusOld));
    const two = await Service.equip(h, { slot: "weapon", item: "pesada_ferreiro" });
    check("E6: arma de duas mãos tira o offhand", two.bag && two.bag.equipped.weapon === "pesada_ferreiro" && !two.bag.equipped.offhand);
    const off = await Service.equip(h, { slot: "offhand", item: "escudo_ferro" });
    check("E6: offhand com arma de duas mãos é recusado com erro", off.code === "twohanded" && off.statusCode === 409);
    const amu = await Service.equip(h, { slot: "amulet", item: "medalhao_lunar" });
    check("E6: um amuleto só (o novo troca o relógio)", amu.bag.equipped.amulet === "medalhao_lunar");
    const legacySlot = await Service.equip(h, { slot: "acc2", item: "relogio_bolso" });
    check("E6: aparelho antigo (acc2) cai no slot da peça", legacySlot.bag.equipped.amulet === "relogio_bolso");
    const sword = await Service.equip(h, { slot: "weapon", item: "espada_latao" });
    check("E6: item de outra família recusado com erro", sword.code === "owned" || sword.code === "clan");
    const wrong = await Service.equip(h, { slot: "boots", item: "luvas_precisao" });
    check("E6: peça fora do slot dela é recusada", wrong.code === "slot");

    console.log(`${checks} verificações de integração passaram.`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
