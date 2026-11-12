// Trilha E, fase 4 (E13–E19): runas, ascensão e despertar, encantamento, preparo, fichas e troca, baús e
// eventos. EXCLUSIVAMENTE banco local descartável:
// TEST_DATABASE_URL=postgres://postgres:<senha>@127.0.0.1:55432/mm_progressao_test node test/meu-mundo-progressao.e2e.js
const target = process.env.TEST_DATABASE_URL;
let parsed;
try { parsed = new URL(target); } catch { /* guard below */ }
if (!parsed || !["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/mm_progressao_test") {
  console.error("Use somente TEST_DATABASE_URL local com banco descartável mm_progressao_test.");
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
  const inst = async (idInstance) => (await pool.query(`SELECT * FROM tb_mm_gear_instance WHERE id_instance=$1`, [idInstance])).rows[0];
  const give = async (u, item, extra = {}) => (await pool.query(
    `INSERT INTO tb_mm_gear_instance (id_user,item_id,plus,grade,ascended,rules) VALUES ($1,$2,$3,$4,$5,'forge-v2') RETURNING id_instance`,
    [u, item, extra.plus || 0, extra.grade || 1, !!extra.ascended])).rows[0].id_instance;
  const emeralds = async (u) => Number((await pool.query(`SELECT balance FROM emerald_wallets WHERE user_id=$1`, [u])).rows[0].balance);
  const liveOf = async (u) => (await pool.query(`SELECT id_character FROM tb_mm_character WHERE id_user=$1 AND status='alive'`, [u])).rows[0].id_character;
  const wear = async (u, slot, idInstance) => pool.query(
    `INSERT INTO tb_mm_loadout (id_character, slot, id_instance) VALUES ($1,$2,$3) ON CONFLICT (id_character, slot) DO UPDATE SET id_instance = EXCLUDED.id_instance`,
    [await liveOf(u), slot, idInstance]);
  try {
    await bootstrap(pool);
    const id = key(), other = key();
    for (const user of [id, other]) {
      await pool.query(`INSERT INTO tb_user VALUES ($1, 'progressao', 'progressao@mm.test')`, [user]);
      await Life.peek(user);
      await pool.query(`INSERT INTO tb_mm_clan (id_user, clan, sex) VALUES ($1, 'vampiro', 'm')`, [user]);
      await pool.query(`INSERT INTO tb_mm_char_adventure (id_character, id_user, xp) SELECT id_character, $1, 500000 FROM tb_mm_character WHERE id_user = $1 AND status = 'alive'`, [user]);
      await pool.query(`INSERT INTO emerald_wallets (user_id, balance) VALUES ($1, 500000) ON CONFLICT (user_id) DO UPDATE SET balance = 500000`, [user]);
    }
    const ctx = { pool, Service, Life, id, other, qty, setQty, inst, give, emeralds, liveOf, wear };
    for (const step of STEPS) await step(ctx);
    console.log(`${checks} verificações de integração passaram.`);
  } finally {
    await pool.end();
  }
}

/** Cada fatia da fase 4 acrescenta o seu passo aqui. */
const STEPS = [
  // ── E13: runas ──
  async ({ pool, Service, id, other, qty, setQty, inst, give, wear }) => {
    const sword = await give(id, "linha_garras_lunares"); // lendária: 2 engastes
    await setQty(id, "runa_ataque_1", 7);
    await setQty(id, "runa_vitalidade_2", 1);
    const v0 = Number((await inst(sword)).version);
    const stale = await Service.socket(id, { instance: sword, rune: "runa_ataque_1", version: v0 + 5, key: key() });
    check("E13: versão velha da cópia recusa o engaste", stale.code === "version" && (await qty(id, "runa_ataque_1")) === 7);
    const sk = key();
    const [a, b] = await Promise.all([
      Service.socket(id, { instance: sword, rune: "runa_ataque_1", version: v0, key: sk }),
      Service.socket(id, { instance: sword, rune: "runa_ataque_1", version: v0, key: sk }),
    ]);
    check("E13: mesma chave em duas abas engasta uma vez", a.receipt && b.receipt && a.receipt.eventId === b.receipt.eventId && (await qty(id, "runa_ataque_1")) === 6);
    check("E13: a runa entra no engaste da cópia", JSON.stringify((await inst(sword)).sockets) === JSON.stringify(["runa_ataque_1"]));
    const second = await Service.socket(id, { instance: sword, rune: "runa_vitalidade_2", version: v0, key: key() });
    check("E13: a versão de antes do primeiro engaste já não vale", second.code === "version");
    const ok2 = await Service.socket(id, { instance: sword, rune: "runa_vitalidade_2", key: key() });
    check("E13: segundo engaste (sem versão) entra e mostra o bônus antes e depois", !ok2.error && ok2.receipt.result.bonusAfter.hp > (ok2.receipt.result.bonusBefore.hp || 0));
    check("E13: lendária sem Ascensão não tem terceiro engaste", (await Service.socket(id, { instance: sword, rune: "runa_ataque_1", key: key() })).code === "socket");
    const piece = ok2.bag.instances.find((x) => x.id === sword);
    check("E13: a mochila mostra as runas e os engastes da cópia", piece.socketsMax === 2 && piece.sockets.length === 2);
    check("E13: outra conta não engasta na cópia", (await Service.socket(other, { instance: sword, rune: "runa_ataque_1", key: key() })).code === "instance");
    const un = await Service.unsocket(id, { instance: sword, index: 1, key: key() });
    check("E13: tirar devolve a runa inteira", !un.error && (await qty(id, "runa_vitalidade_2")) === 1 && JSON.stringify((await inst(sword)).sockets) === JSON.stringify(["runa_ataque_1"]));
    check("E13: engaste vazio recusa", (await Service.unsocket(id, { instance: sword, index: 1, key: key() })).code === "nosocket");
    const common = await give(id, "espada_aco");
    check("E13: peça comum não tem engaste", (await Service.socket(id, { instance: common, rune: "runa_ataque_1", key: key() })).code === "socket");
    const fk = key();
    const f1 = await Service.fuseRunes(id, { rune: "runa_ataque_1", qty: 2, key: fk });
    const f2 = await Service.fuseRunes(id, { rune: "runa_ataque_1", qty: 2, key: fk });
    check("E13: funde 6 de grau I em 2 de grau II, uma vez", f1.receipt.eventId === f2.receipt.eventId && (await qty(id, "runa_ataque_1")) === 0 && (await qty(id, "runa_ataque_2")) === 2);
    check("E13: sem 3 runas recusa a fusão", (await Service.fuseRunes(id, { rune: "runa_ataque_2", key: key() })).code === "needs");
    check("E13: grau V não funde", (await Service.fuseRunes(id, { rune: "runa_ataque_5", key: key() })).code === "max");
    const rare = await give(id, "espada_chama");
    await Service.socket(id, { instance: rare, rune: "runa_ataque_2", key: key() });
    check("E13: peça com runa não recicla", (await Service.recycle(id, { item: "espada_chama", instance: rare, key: key() })).code === "socketed");
    const sv = await Service.salvage(id, { item: "espada_chama", instance: rare, key: key(), confirm: true });
    check("E13: desmontar devolve a runa engastada", !sv.error && sv.receipt.result.back.runa_ataque_2 === 1 && (await qty(id, "runa_ataque_2")) === 2);
    // a arma de fogo não vale para quem veste espada: a luta lê uma espada rara com runa
    const worn = await give(id, "espada_carmesim");
    await Service.socket(id, { instance: worn, rune: "runa_ataque_2", key: key() });
    await wear(id, "weapon", worn);
    const c = await pool.connect();
    try {
      const g = await Service.fightGear(c, id, "vampiro");
      const Gear = require("../src/utils/meuMundoGear");
      const plain = Gear.gearBonus({ weapon: { id: "espada_carmesim", level: 0, grade: 1 } });
      check("E13: a luta soma a runa engastada na arma vestida", g.dmg > plain.dmg);
    } finally { c.release(); }
  },
  // ── E14: Ascensão e Despertar ──
  async ({ pool, Service, id, other, qty, setQty, inst, give, wear }) => {
    const piece = await give(id, "espada_carmesim", { plus: 9 }); // rara (T3): 1 engaste
    await setQty(id, "selo_dominio", 20);
    check("E14: abaixo do +10 não ascende", (await Service.ascend(id, { instance: piece, key: key() })).code === "plus" && (await qty(id, "selo_dominio")) === 20);
    await pool.query(`UPDATE tb_mm_gear_instance SET plus = 10 WHERE id_instance = $1`, [piece]);
    check("E14: +10 sem Ascensão não sobe para o +11", (await Service.upgrade(id, { item: "espada_carmesim", instance: piece, key: key() })).code === "ascend");
    const ak = key();
    const [a, b] = await Promise.all([Service.ascend(id, { instance: piece, key: ak }), Service.ascend(id, { instance: piece, key: ak })]);
    check("E14: Ascensão cobra 2 × tier Selos (6) uma vez", a.receipt && a.receipt.eventId === b.receipt.eventId && (await qty(id, "selo_dominio")) === 14 && (await inst(piece)).ascended === true);
    check("E14: a ascendida ganha um engaste (rara: 1 → 2)", a.receipt.result.socketsBefore === 1 && a.receipt.result.socketsAfter === 2 && a.bag.instances.find((x) => x.id === piece).socketsMax === 2);
    check("E14: ascender de novo recusa", (await Service.ascend(id, { instance: piece, key: key() })).code === "ascended" && (await qty(id, "selo_dominio")) === 14);
    await setQty(id, "pedra_aprimoramento", 100);
    const up = await Service.upgrade(id, { item: "espada_carmesim", instance: piece, key: key() });
    check("E14: ascendida passa do +10 para o +11", !up.error && (await inst(piece)).plus === 11);
    // Despertar
    const fresh = await give(id, "espada_carmesim", { plus: 10 });
    check("E14: Despertar sem Ascensão recusa", (await Service.awaken(id, { instance: fresh, key: key() })).code === "notascended");
    check("E14: sem Essência o Despertar recusa", (await Service.awaken(id, { instance: piece, key: key() })).code === "needs" && (await inst(piece)).awakened === false);
    await setQty(id, "essencia_primordial", 3);
    const aw = await Service.awaken(id, { instance: piece, key: key() });
    check("E14: Despertar cobra tier Essências e tier Selos (3 e 3)", !aw.error && (await qty(id, "essencia_primordial")) === 0 && (await qty(id, "selo_dominio")) === 11 && (await inst(piece)).awakened === true);
    check("E14: o recibo mostra a passiva somada à chave principal", aw.receipt.result.bonusAfter.dmg > aw.receipt.result.bonusBefore.dmg);
    check("E14: despertar de novo recusa", (await Service.awaken(id, { instance: piece, key: key() })).code === "awakened");
    check("E14: outra conta não ascende a cópia", (await Service.ascend(other, { instance: fresh, key: key() })).code === "instance");
    await wear(id, "weapon", piece);
    const c = await pool.connect();
    try {
      const look = await Service.fightAppearance(c, id, "vampiro");
      check("E14: o ticket leva a arma desperta (só visual)", look.weaponId === "espada_carmesim" && look.awakened === "aether");
      const g = await Service.fightGear(c, id, "vampiro");
      const Gear = require("../src/utils/meuMundoGear");
      check("E14: a luta soma a passiva da arma desperta", g.dmg > Gear.gearBonus({ weapon: { id: "espada_carmesim", level: 11, grade: 1 } }).dmg);
    } finally { c.release(); }
  },
  // ── E15: Encantamento ──
  async ({ pool, Service, id, other, qty, setQty, inst, give }) => {
    const helm = require("../src/utils/mmItems").GEAR_BY_ID.get("oculos_engenheiro"); // T2: 20 Pó + 2 Cristal
    const piece = await give(id, helm.id);
    await setQty(id, "po_refino", 25);
    await setQty(id, "cristal_bruto", 2);
    check("E15: sem sorteio não há o que escolher", (await Service.enchantResolve(id, { instance: piece, choice: null, key: key() })).code === "nooffer");
    const R0 = Service.R;
    Service.R = () => 0;
    const ek = key();
    const [a, b] = await Promise.all([Service.enchant(id, { instance: piece, key: ek }), Service.enchant(id, { instance: piece, key: ek })]);
    Service.R = R0;
    check("E15: sortear cobra 10 × tier Pó e tier Cristal uma vez", a.receipt && a.receipt.eventId === b.receipt.eventId && (await qty(id, "po_refino")) === 5 && (await qty(id, "cristal_bruto")) === 0);
    const options = a.receipt.result.options;
    check("E15: o sorteio traz opções do slot sem repetir a principal nem a secundária", options.length >= 1 && options.every((k) => !helm.keys.includes(k)));
    const view = a.bag.forge[piece].enchant;
    check("E15: a bancada mostra o sorteio com o bônus de cada opção", view.offer && view.offer.length === options.length && view.offer.every((o) => o.bonus[o.key] > 0));
    check("E15: com sorteio esperando, outro sorteio recusa", (await Service.enchant(id, { instance: piece, key: key() })).code === "offer");
    const before = JSON.stringify((await inst(piece)).affixes);
    check("E15: opção que não saiu recusa", (await Service.enchantResolve(id, { instance: piece, choice: "dmg", key: key() })).code === "choice");
    const keep = await Service.enchantResolve(id, { instance: piece, choice: null, key: key() });
    check("E15: recusar não muda nada e não cobra de novo", !keep.error && keep.receipt.result.kept === true && !(await inst(piece)).affixes.enchant && (await qty(id, "po_refino")) === 5 && JSON.stringify(keep.receipt.result.bonusAfter) === JSON.stringify(keep.receipt.result.bonusBefore));
    check("E15: depois de recusar não há sorteio esperando", !(await inst(piece)).affixes.offer && before.includes("offer"));
    await setQty(id, "cristal_bruto", 2);
    await setQty(id, "po_refino", 20);
    const roll = await Service.enchant(id, { instance: piece, key: key() });
    const pick = roll.receipt.result.options[0];
    const take = await Service.enchantResolve(id, { instance: piece, choice: pick, key: key() });
    check("E15: aceitar troca a chave secundária pela escolhida", !take.error && (await inst(piece)).affixes.enchant === pick && take.receipt.result.to === pick && take.receipt.result.bonusAfter[pick] > 0);
    check("E15: outra conta não encanta a cópia", (await Service.enchant(other, { instance: piece, key: key() })).code === "instance");
    const off = require("../src/utils/mmItems").GEAR.find((g) => g.slot === "offhand" && g.keys);
    const shield = await give(id, off.id);
    check("E15: peça sem outra chave no slot não encanta", (await Service.enchant(id, { instance: shield, key: key() })).code === "noenchant");
  },
];

main().catch((error) => { console.error(error); process.exit(1); });
