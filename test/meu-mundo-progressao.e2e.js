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
  await pool.query(`DROP TABLE IF EXISTS tb_mm_event, tb_mm_chest_open, tb_mm_collection, tb_mm_loadout, tb_mm_item_ledger, tb_mm_gear_instance, tb_mm_refine_proposal, tb_mm_gear_unlock, tb_mm_quest, tb_mm_equip, tb_mm_gear,
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
  // ── weapon-v1 (24/11/2026): runas, Ascensão, Despertar e encanto saíram — o que já foi investido continua ──
  async ({ pool, Service, id, other, qty, setQty, inst, give, wear }) => {
    const Gear = require("../src/utils/meuMundoGear");
    const sword = await give(id, "espada_carmesim", { plus: 11, ascended: true });
    await pool.query(`UPDATE tb_mm_gear_instance SET sockets='["runa_ataque_2"]'::jsonb, awakened=true WHERE id_instance=$1`, [sword]);
    const plain = await give(id, "espada_carmesim", { plus: 11 });
    await setQty(id, "runa_ataque_1", 7);
    await wear(id, "weapon", plain);
    const fight = async () => { const c = await pool.connect(); try { return await Service.fightGear(c, id, "vampiro"); } finally { c.release(); } };
    const gPlain = await fight();
    await wear(id, "weapon", sword);
    const gInvested = await fight();
    check("a runa engastada e o Despertar de antes seguem somando na luta", gInvested.dmg > gPlain.dmg);
    const row = await inst(sword);
    check("a cópia investida vira weapon-v1 sem perder runa nem Despertar", row.rules === "weapon-v1" && row.awakened === true && JSON.stringify(row.sockets) === JSON.stringify(["runa_ataque_2"]) && row.weapon_level === 67);
    for (const [m, body] of [["socket", { rune: "runa_ataque_1" }], ["unsocket", { index: 0 }], ["fuseRunes", { rune: "runa_ataque_1" }], ["ascend", {}], ["awaken", {}], ["enchant", {}], ["enchantResolve", { choice: null }]]) {
      const res = await Service[m](id, { instance: sword, key: key(), ...body });
      assert.equal(res.statusCode, 410, m);
    }
    check("engastar, tirar, fundir, Ascensão, Despertar e encanto respondem 410", JSON.stringify((await inst(sword)).sockets) === JSON.stringify(["runa_ataque_2"]));
    check("as runas soltas viraram pó novo (runa aposentada)", (await qty(id, "runa_ataque_1")) === 0 && (await qty(id, "po_ref_d")) > 0);
    check("a arma de outra conta continua fora do meu alcance", (await Service.refineWeapon(other, { instance: sword, key: key() })).code === "instance");
    void Gear;
  },
  // ── E16: consumíveis de preparo ──
  async ({ pool, id, other, qty, setQty }) => {
    const Adv = require("../src/services/MeuMundoAdventureService");
    await setQty(id, "tonico_vida", 2);
    const open = await Adv.fightStart(id, { origin: "laminas", kind: "brute", level: 1 });
    check("E16: a luta abre sem preparo", !open.error && open.fight.setup.prep === null);
    const t = open.fight.ticket;
    check("E16: item que não é de preparo recusa", (await Adv.fightPrep(id, { ticket: t, item: "pedra_aprimoramento" })).code === "prepitem");
    check("E16: ticket de outra conta recusa", (await Adv.fightPrep(other, { ticket: t, item: "tonico_vida" })).code === "ticket");
    const p = await Adv.fightPrep(id, { ticket: t, item: "tonico_vida" });
    const row = (await pool.query(`SELECT setup FROM tb_mm_fight WHERE id_fight = $1`, [t])).rows[0].setup;
    check("E16: o preparo gasta 1 e vai para o ticket", !p.error && (await qty(id, "tonico_vida")) === 1 && row.prep && row.prep.key === "hp" && row.prep.v === 0.05 && p.fight.setup.prep.key === "hp");
    check("E16: o ticket devolvido é o mesmo, com o preparo", p.fight.ticket === t && p.fight.setup.seed === open.fight.setup.seed);
    check("E16: um preparo por luta", (await Adv.fightPrep(id, { ticket: t, item: "tonico_vida" })).code === "prepdone" && (await qty(id, "tonico_vida")) === 1);
    const ledger = (await pool.query(`SELECT delta FROM tb_mm_item_ledger WHERE id_user=$1 AND item_id='tonico_vida' ORDER BY id DESC LIMIT 1`, [id])).rows[0];
    check("E16: o gasto entra no livro de itens", ledger && Number(ledger.delta) === -1);
    const boxe = await Adv.fightStart(id, { origin: "boxe", kind: "brute", level: 1 });
    check("E16: o Boxe recusa o preparo", !boxe.error && (await Adv.fightPrep(id, { ticket: boxe.fight.ticket, item: "tonico_vida" })).code === "prepfight" && (await qty(id, "tonico_vida")) === 1);
    await setQty(id, "tonico_vida", 0);
    const again = await Adv.fightStart(id, { origin: "laminas", kind: "brute", level: 1 });
    check("E16: sem o consumível recusa", (await Adv.fightPrep(id, { ticket: again.fight.ticket, item: "tonico_vida" })).code === "prepowned");
    // o Poder lê o equipamento (fightGear); o preparo mora só no ticket
    const Gear = require("../src/services/MeuMundoGearService");
    const c = await pool.connect();
    try {
      const gear = await Gear.fightGear(c, id, "vampiro");
      check("E16: o preparo não entra no equipamento que o Poder lê", JSON.stringify(gear) === JSON.stringify(open.fight.setup.gear) && !("prep" in gear));
    } finally { c.release(); }
  },
  // ── E17: fichas e loja de troca ──
  async ({ Service, id, qty, setQty }) => {
    await setQty(id, "ficha_paint", 40);
    check("E17: troca inexistente recusa", (await Service.exchange(id, { offer: "paint:nada", key: key() })).code === "offerid");
    const xk = key();
    const [a, b] = await Promise.all([
      Service.exchange(id, { offer: "paint:frag_d", qty: 1, key: xk }),
      Service.exchange(id, { offer: "paint:frag_d", qty: 1, key: xk }),
    ]);
    // weapon-v1: a loja vende pó das faixas baixas e fragmento de classe (o caminho previsível)
    check("E17: troca 15 fichas por 3 fragmentos de classe D uma vez (mesma chave)", a.receipt && a.receipt.eventId === b.receipt.eventId && (await qty(id, "ficha_paint")) === 25 && (await qty(id, "frag_classe_d")) === 3);
    check("E17: fichas insuficientes recusa", (await Service.exchange(id, { offer: "paint:frag_d", qty: 2, key: key() })).code === "tokens" && (await qty(id, "ficha_paint")) === 25);
    const two = await Service.exchange(id, { offer: "paint:po_c", qty: 1, key: key() });
    check("E17: o recibo mostra fichas gastas e itens recebidos", !two.error && two.receipt.items.some((l) => l.id === "ficha_paint" && l.qty === -8) && two.receipt.items.some((l) => l.id === "po_ref_c" && l.qty === 1));
    check("E17: ficha de outro jogo não paga", (await Service.exchange(id, { offer: "jetpack:po_d", key: key() })).code === "tokens");
    check("E17: oferta da forja antiga não existe mais", (await Service.exchange(id, { offer: "paint:pedra", key: key() })).code === "offerid");
  },
  // ── E17: tabelas da luta (Hall só ficha; rua comum × elite) ──
  async ({ pool, id, qty }) => {
    const Reward = require("../src/services/MeuMundoRewardService");
    const Life = require("../src/services/MeuMundoLifeService");
    const out = await Life.withLife(id, async (s, ctx) => ({
      hall: await Reward.grant(ctx.client, id, { table: "fight:hall", ctx, R: () => 0.5, roll: { win: true, activeMs: 180000 } }),
      elite: await Reward.grant(ctx.client, id, { table: "mob:elite", ctx, R: () => 0.5, roll: { win: true, activeMs: 180000 } }),
    }));
    check("E17: o Hall entrega só ficha (2 + 1 pela vitória)", out.hall.length === 1 && out.hall[0].id === "ficha_hall" && out.hall[0].qty === 3);
    check("E17: o elite da rua entrega fragmento de classe C e pó B", out.elite.some((l) => l.id === "frag_classe_c" && l.qty >= 2) && out.elite.some((l) => l.id === "po_ref_b"));
    check("E17: a entrega passa pela mochila (com livro)", (await qty(id, "ficha_hall")) === 3);
  },
  // ── E18: baús e coleção ──
  async ({ pool, Service, id, other, qty, liveOf }) => {
    const visit = async (u, place) => pool.query(`INSERT INTO tb_mm_character_event (id_character, kind, data, at) VALUES ($1, 'visit', $2, NOW())`, [await liveOf(u), JSON.stringify({ place })]);
    const before = await Service.collection(id);
    check("E18: a coleção lista todo item, com o oculto como ???", before.items.length === before.total && before.items.some((x) => x.hidden && x.id === null) && before.found > 0);
    check("E18: baú desconhecido recusa", (await Service.openChest(id, { chest: "bau_nada", key: key() })).code === "chest");
    check("E18: longe do baú não abre", (await Service.openChest(id, { chest: "bau_biblioteca", key: key() })).code === "chestfar");
    await visit(id, "biblioteca");
    const ck = key();
    const [a, b] = await Promise.all([Service.openChest(id, { chest: "bau_biblioteca", key: ck }), Service.openChest(id, { chest: "bau_biblioteca", key: ck })]);
    check("E18: abre o baú no lugar dele (mesma chave = um recibo; 2 pós S e 5 fragmentos A)", a.receipt && a.receipt.eventId === b.receipt.eventId && (await qty(id, "po_ref_s")) === 2 && (await qty(id, "frag_classe_a")) === 5);
    const again = await Service.openChest(id, { chest: "bau_biblioteca", key: key() });
    check("E18: abrir o mesmo baú de novo (outra chave) não entrega", again.code === "chestopen" && (await qty(id, "po_ref_s")) === 2);
    const after = await Service.collection(id);
    check("E18: o que saiu do baú entra na coleção", after.found > before.found && after.items.find((x) => x.id === "po_ref_s").found);
    check("E18: o baú aparece aberto na coleção", after.chests.find((x) => x.id === "bau_biblioteca").opened === true);
    const g = await Service.get(id);
    check("E18 + weapon-v1: a receita oculta de runa saiu (ninguém a vê no catálogo)", !g.gear.recipes.some((r) => r.id === "gravar_runa_forca"));
    await visit(other, "biblioteca");
    check("E18: o baú é um por conta (outra conta abre o dela)", !(await Service.openChest(other, { chest: "bau_biblioteca", key: key() })).error);
  },
  // ── E19: eventos (ligado e desligado) ──
  async ({ Service, Life, id, qty, setQty }) => {
    const Events = require("../src/services/MeuMundoEventService");
    const Reward = require("../src/services/MeuMundoRewardService");
    const play = async () => (await Life.withLife(id, async (s, ctx) => ({ drops: await Reward.grant(ctx.client, id, { table: "minigame:jetpack", ctx, R: () => 0.5, roll: { win: true, activeMs: 4 * 60000 } }) }))).drops;
    const cfg = await Events.config();
    check("E19: o evento nasce desligado", cfg.events.length >= 1 && cfg.events.every((e) => !e.active && !e.open));
    const off = await play();
    check("E19: desligado, a partida não paga ficha de evento", !off.some((l) => l.id === "ficha_evento"));
    await setQty(id, "ficha_evento", 100);
    check("E19: desligado, a loja de evento não abre", (await Service.exchange(id, { offer: "festa_lumen:po_ssr", key: key() })).code === "offerid" && (await qty(id, "ficha_evento")) === 100);
    check("E19: evento desconhecido e pedido sem ligar/desligar recusam", (await Events.save(id, { event: "nada", active: true })).code === "event" && (await Events.save(id, { event: "festa_lumen" })).code === "active");
    const on = await Events.save(id, { event: "festa_lumen", active: true, hours: 48 });
    check("E19: o admin liga o evento (com fim)", on.events.find((e) => e.id === "festa_lumen").open === true && !!on.events.find((e) => e.id === "festa_lumen").endsAt);
    const paid = await play();
    check("E19: ligado, a partida paga ficha de evento (2 + 1 pela vitória)", paid.some((l) => l.id === "ficha_evento" && l.qty === 3) && (await qty(id, "ficha_evento")) === 103);
    const bag = (await Service.get(id)).bag;
    check("E19: a mochila diz quais eventos estão ligados", Array.isArray(bag.events) && bag.events.includes("festa_lumen"));
    const buy = await Service.exchange(id, { offer: "festa_lumen:po_divine", key: key() });
    check("E19: ligado, a loja de evento troca (80 fichas → 1 Pó Divina; weapon-v2: era o SSS III)", !buy.error && (await qty(id, "ficha_evento")) === 23 && (await qty(id, "po_ref_divine")) === 1);
    await Events.save(id, { event: "festa_lumen", active: false });
    check("E19: desligado de novo, a loja fecha e a ficha fica guardada", (await Service.exchange(id, { offer: "festa_lumen:po_legendary", key: key() })).code === "offerid" && (await qty(id, "ficha_evento")) === 23);
    await Events.save(id, { event: "festa_lumen", active: true, hours: 1 });
    const later = (await Life.withLife(id, async (s, ctx) => ({ open: await Events.isOpen(ctx.client, "festa_lumen", Date.now() + 2 * 3600 * 1000) }))).open;
    check("E19: o evento com fim fecha sozinho depois do prazo", later === false);
    await Events.save(id, { event: "festa_lumen", active: false });
  },
];

main().catch((error) => { console.error(error); process.exit(1); });
