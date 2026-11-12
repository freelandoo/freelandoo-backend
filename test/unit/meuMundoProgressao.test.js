// Trilha E, fase 4 (E13…E19) — regras puras da progressão avançada (plano 2026-11-11, §8).
// E13: runas (valor, subteto, fusão, engastes).
const test = require("node:test");
const assert = require("node:assert");
const Items = require("../../src/utils/mmItems");
const Gear = require("../../src/utils/meuMundoGear");
const B = require("../../src/utils/mmItems/rules/budget");
const Runes = require("../../src/utils/mmItems/rules/runes");

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test("E13 — 35 runas: 7 chaves × 5 graus, empilham, raridade pelo grau, todas com origem", () => {
  const runes = Items.GEAR.filter((g) => g.category === "rune");
  assert.strictEqual(runes.length, 35);
  for (const r of runes) {
    const p = Runes.parseRune(r.id);
    assert.ok(p, r.id);
    assert.strictEqual(r.stack, true, r.id);
    assert.strictEqual(r.rarity, Runes.RARITY_OF_GRADE[p.grade - 1], r.id);
    assert.ok(Items.sourcesOf(r).length > 0, `${r.id} sem origem`);
  }
  assert.strictEqual(Items.validateCatalog().length, 0);
});

test("E13 — runa de grau g = TETO × 0,10 × (g ÷ 5) ÷ 8 na chave dela", () => {
  for (const [kind, k] of Object.entries(Runes.RUNE_KINDS)) {
    for (let g = 1; g <= 5; g++) assert.ok(near(Runes.runeValue(k, g), (B.CAP[k] * 0.1 * (g / 5)) / 8), `${kind} ${g}`);
  }
  assert.ok(near(Runes.runeValue("dmg", 5) * 8, B.sourceCap("dmg", "runes")));
});

test("E13 — subteto: 24 runas de ataque V não passam de 0,035 de dano", () => {
  const sword = Items.GEAR_BY_ID.get("linha_garras_lunares");
  const pieces = Array.from({ length: 8 }, () => ({ item: sword, plus: 0, grade: 1, sockets: ["runa_ataque_5", "runa_ataque_5", "runa_ataque_5"] }));
  const { sources, bonus } = Items.bonusOf(pieces);
  assert.ok(sources.dmg.runes > 0.035);
  const noRunes = Items.bonusOf(pieces.map((p) => ({ ...p, sockets: [] }))).bonus.dmg;
  assert.ok(near(bonus.dmg - noRunes, 0.035, 1e-4), `${bonus.dmg} − ${noRunes}`);
});

test("E13 — gearBonus soma as runas da cópia vestida; runa fora das chaves da peça também vale", () => {
  const eq = { weapon: { id: "linha_garras_lunares", level: 0, grade: 1 } };
  const plain = Gear.gearBonus(eq);
  const withRunes = Gear.gearBonus({ weapon: { ...eq.weapon, sockets: ["runa_vitalidade_3", "runa_ataque_1"] } });
  assert.ok(near(withRunes.hp - plain.hp, Runes.runeValue("hp", 3), 1e-4));
  assert.ok(near(withRunes.dmg - plain.dmg, Runes.runeValue("dmg", 1), 1e-4));
});

test("E13 — fusão: 3 de grau N → 1 de grau N+1; grau V = 81 de grau I; grau V não funde", () => {
  assert.deepStrictEqual(Runes.fuseCost("runa_ataque_1", 2), { needs: { runa_ataque_1: 6 }, gives: { runa_ataque_2: 2 } });
  assert.strictEqual(Runes.fuseCost("runa_ataque_5").error, "max");
  assert.strictEqual(Runes.fuseCost("pedra_aprimoramento").error, "item");
  assert.strictEqual(Runes.fuseCost("runa_ataque_1", 0).error, "owned");
  let n = 1;
  for (let g = 5; g > 1; g--) n *= Runes.FUSE_IN;
  assert.strictEqual(n, 81);
});

test("E13 — engastes: raro 1 · épico 2 · lendário 2 · mítico 3; ascendida +1 (teto 3); comum 0", () => {
  const byRarity = (r) => Items.GEAR.find((g) => g.slot && g.rarity === r);
  assert.strictEqual(Runes.socketsOf(byRarity("common")), 0);
  assert.strictEqual(Runes.socketsOf(byRarity("rare")), 1);
  assert.strictEqual(Runes.socketsOf(byRarity("epic")), 2);
  assert.strictEqual(Runes.socketsOf(byRarity("legendary")), 2);
  assert.strictEqual(Runes.socketsOf(byRarity("legendary"), true), 3);
  assert.strictEqual(Runes.socketsOf(byRarity("epic"), true), 3);
  assert.strictEqual(Runes.socketsOf(Items.GEAR_BY_ID.get("runa_ataque_1")), 0);
});

test("E13 — runas de grau I e II caem nos Domínios no fim da lista (os sorteios de antes não mudam)", () => {
  const t = Items.LOOT_TABLES["domain:floresta:3"];
  const ids = t.chance.map((e) => e.id);
  assert.deepStrictEqual(ids.slice(-2), ["runa_destreza_1", "runa_forca_1"]);
  const boss = Items.LOOT_TABLES["domain:vulcao:10"].chance.map((e) => e.id);
  assert.strictEqual(boss[boss.length - 1], "runa_ataque_2");
  for (const kind of Object.keys(Runes.RUNE_KINDS)) assert.ok(Items.lootSourcesOf(`runa_${kind}_1`).length > 0, kind);
});

// ── E19: eventos ──
const Events = require("../../src/utils/mmItems/catalog/events");

test("E19 — loja de evento: ofertas em ficha_evento presas a um evento do catálogo; baú não paga ficha de evento", () => {
  const ev = Items.EXCHANGE.OFFERS.filter((o) => o.event);
  assert.ok(ev.length >= 3);
  for (const o of ev) {
    assert.strictEqual(o.token, Events.EVENT_TOKEN, o.id);
    assert.ok(Events.EVENT_BY_ID.has(o.event), o.id);
  }
  assert.ok(Events.PAYS_EVENT("minigame:paint") && Events.PAYS_EVENT("domain:floresta:3") && Events.PAYS_EVENT("mob:elite"));
  assert.ok(!Events.PAYS_EVENT("chest:bau_ninho"));
});

// ── E18: baús e coleção ──
const Chests = require("../../src/utils/mmItems/catalog/chests");

test("E18 — baús nos pontos de visita do bairro e do centro, conteúdo fixo (sem sorteio)", () => {
  const Center = require("../../src/utils/meuMundoCenter");
  const Layout = require("../../src/utils/meuMundoLayout");
  const points = new Set([...Center.VISIT_POINTS, ...Layout.VISIT_POINTS].map((p) => p.id));
  assert.ok(Chests.CHESTS.some((c) => c.where === "bairro") && Chests.CHESTS.some((c) => c.where === "centro"));
  for (const c of Chests.CHESTS) {
    for (const p of c.places) assert.ok(points.has(p), `${c.id}: ponto ${p}`);
    let calls = 0;
    const got = Items.rollTable(c.table, { win: true }, () => { calls++; return 0.5; });
    assert.strictEqual(calls, 0, `${c.id} não sorteia`);
    assert.deepStrictEqual(Object.fromEntries(got.map((x) => [x.id, x.qty])), c.gives);
  }
});

test("E18 — a receita oculta só sai de baú e fica fora do catálogo público até ser descoberta", () => {
  const pub = Gear.publicGear();
  assert.ok(!pub.items.some((i) => i.id === "receita_oculta_forca"));
  assert.ok(!pub.recipes.some((r) => r.id === "gravar_runa_forca"));
  const seen = Gear.publicGear({ reveal: (id) => id === "receita_oculta_forca" });
  assert.ok(seen.items.some((i) => i.id === "receita_oculta_forca") && seen.recipes.some((r) => r.id === "gravar_runa_forca"));
  assert.deepStrictEqual(Items.lootSourcesOf("receita_oculta_forca").map((s) => s.table), ["chest:bau_biblioteca"]);
});

// ── E17: tabelas por atividade, fichas e loja de troca ──
const Exchange = require("../../src/utils/mmItems/catalog/exchange");
const Reward = require("../../src/services/MeuMundoRewardService");

test("E17 — fichas por partida = minutos ativos ÷ 2 (arredondado) + 1 se venceu", () => {
  const roll = (activeMs, win) => (Items.rollTable("minigame:jetpack", { win, activeMs }, () => 0.99).find((x) => x.id === "ficha_jetpack") || { qty: 0 }).qty;
  assert.strictEqual(roll(5 * 60000, true), 4); // 2,5 → 3, +1
  assert.strictEqual(roll(5 * 60000, false), 3);
  assert.strictEqual(roll(12 * 60000, true), 7);
  assert.strictEqual(roll(30000, false), 0);
});

test("E17 — o item mais caro de cada loja de minijogo custa entre 40 e 60 partidas", () => {
  for (const game of Exchange.GAMES) {
    const max = Math.max(...Exchange.OFFERS.filter((o) => o.token === `ficha_${game}`).map((o) => o.cost));
    const matches = max / Exchange.TOKENS_PER_MATCH;
    assert.ok(matches >= 40 && matches <= 60, `${game}: ${matches} partidas`);
  }
  for (const o of Exchange.OFFERS) for (const id of [o.token, ...Object.keys(o.gives)]) assert.ok(Items.GEAR_BY_ID.has(id), `${o.id}: ${id}`);
  assert.strictEqual(new Set(Exchange.OFFERS.map((o) => o.id)).size, Exchange.OFFERS.length);
});

test("E17 — tabela da luta: Hall só ficha; rua comum × elite pela régua (fator ≥ 1,40)", () => {
  assert.strictEqual(Reward.fightTableOf("hall"), "fight:hall");
  assert.strictEqual(Reward.fightTableOf("laminas"), null);
  const A = require("../../src/utils/meuMundoAdventure");
  for (const L of [1, 10, 30, 100]) {
    // o sorteio da rua: ×1,00 e ×1,10 e ×1,25 são comuns; ×1,40 e ×1,60 são elite
    const lv = [0.1, 0.4, 0.6, 0.8, 0.95].map((r) => A.rollMobLevel(L, () => r));
    assert.deepStrictEqual(lv.map((M) => Reward.fightTableOf("mob", { level: M, hero: L })), ["mob:common", "mob:common", "mob:common", "mob:elite", "mob:elite"], `nível ${L}`);
  }
  const elite = Items.lootExpectation("mob:elite", { win: true, activeMs: 240000, first: true });
  assert.ok(elite.frag_lamina_correntes.min >= 3 + 10 && elite.receita_lamina_correntes.min === 1);
  assert.ok(!Items.lootExpectation("mob:common", { win: true, activeMs: 240000 }).frag_lamina_correntes);
});

// ── E16: Consumíveis de preparo ──
const Fight = require("../../src/utils/meuMundoFight");

test("E16 — 8 consumíveis de preparo, +5% cada numa chave, receita na Forja (kind prep)", () => {
  const list = Items.GEAR.filter((g) => g.category === "consumable");
  assert.strictEqual(list.length, 8);
  assert.strictEqual(new Set(list.map((g) => g.prep.key)).size, 8);
  for (const g of list) {
    assert.ok(g.prep.v <= Fight.PREP_MAX + 1e-12, g.id);
    assert.ok(Items.RECIPES.some((r) => r.out === g.id && r.kind === "prep"), g.id);
  }
});

test("E16 — preparo soma DEPOIS do teto do equipamento, no máximo +5%, e re-simula igual", () => {
  const base = { kind: "brute", level: 10, hero: 10, tier: "arena", seed: 1234, stats: { strength: 300, speed: 300, intelligence: 300, dexterity: 300 }, gear: { hp: 0.25, dmg: 0.35 } };
  const plain = new Fight.Fight(base);
  const prep = new Fight.Fight({ ...base, prep: { key: "hp", v: 0.05 } });
  const cheat = new Fight.Fight({ ...base, prep: { key: "hp", v: 0.9 } });
  assert.ok(near(plain.gear.hp, 0.25) && near(prep.gear.hp, 0.3), "passa do teto de 0,25");
  assert.ok(prep.me.hpMax > plain.me.hpMax);
  assert.strictEqual(cheat.me.hpMax, prep.me.hpMax, "valor acima de 5% é cortado");
  assert.strictEqual(new Fight.Fight({ ...base, prep: { key: "xyz", v: 0.05 } }).me.hpMax, plain.me.hpMax, "chave desconhecida não vale");
  // a mesma gravação com e sem preparo: cada lado re-simula sempre igual a si mesmo
  const frames = { v: 1, n: 600, inputs: [] };
  const a = Fight.replayFight({ ...base, prep: { key: "dmg", v: 0.05 } }, frames);
  const b = Fight.replayFight({ ...base, prep: { key: "dmg", v: 0.05 } }, frames);
  const c = Fight.replayFight(base, frames);
  assert.deepStrictEqual(a, b);
  assert.ok(c && typeof c.ok === "boolean");
});

// ── E15: Encantamento ──
const Enchant = require("../../src/utils/mmItems/rules/enchant");

test("E15 — sorteio: até 3 chaves do slot, nunca a principal nem a secundária de agora; custo 10 × tier Pó + tier Cristal", () => {
  const helm = Items.GEAR.find((g) => g.slot === "helm" && g.keys);
  const seq = [0.1, 0.9, 0.5];
  let i = 0;
  const opts = Enchant.rollOptions(helm, null, () => seq[i++ % 3]);
  assert.ok(opts.length >= 1 && opts.length <= 3);
  assert.strictEqual(new Set(opts).size, opts.length);
  for (const k of opts) assert.ok(!helm.keys.includes(k) && B.slotKeys("helm").includes(k), k);
  assert.deepStrictEqual(Enchant.enchantCost(helm).needs, { po_refino: 10 * helm.tier, cristal_bruto: helm.tier });
  // mão secundária só tem 2 chaves: não encanta
  const off = Items.GEAR.find((g) => g.slot === "offhand" && g.keys);
  assert.strictEqual(Enchant.enchantCost(off).error, "noenchant");
});

test("E15 — encantada: a secundária vira a chave nova (ênfase 0,5) e soma a fatia 0,05 pelo peso do slot", () => {
  const sword = Items.GEAR_BY_ID.get("linha_garras_lunares"); // dmg, acc
  const eff = Enchant.effectiveKeys(sword, "power");
  assert.deepStrictEqual(eff, ["dmg", "power"]);
  const plain = Items.pieceBonus(sword, 0, 1);
  const enc = Items.pieceBonus(sword, 0, 1, { enchant: "power" });
  assert.ok(!enc.acc, "a secundária de antes sai");
  const expected = B.piece("power", "weapon", "legendary", 0, 1, 0.5) + B.sourceCap("power", "enchant") * B.WEIGHT.power.weapon;
  assert.ok(near(enc.power, expected, 1e-4), enc.power + " × " + expected);
  assert.ok(near(enc.dmg, plain.dmg, 1e-9));
  // chave que não é do slot é ignorada (vale a de antes)
  assert.deepStrictEqual(Enchant.effectiveKeys(sword, "hp"), sword.keys);
  const g = Gear.gearBonus({ weapon: { id: sword.id, level: 0, grade: 1, enchant: "power" } });
  assert.ok(g.power > 0 && !g.acc);
});

test("E15 — todos os slots de uma chave encantados = a fatia inteira", () => {
  for (const k of B.KEYS) {
    let sum = 0;
    for (const slot of Object.keys(B.WEIGHT[k])) sum += Enchant.enchantValue({ slot, tier: 6, keys: ["x", "y"] }, k)[k];
    assert.ok(near(sum, B.sourceCap(k, "enchant"), 1e-9), k);
  }
});

// ── E14: Ascensão e Despertar ──
const Ascend = require("../../src/utils/mmItems/rules/ascend");

test("E14 — Ascensão: só no +10, custa 2 × tier Selos, uma vez", () => {
  const it = Items.GEAR_BY_ID.get("linha_garras_lunares"); // lendária, T5
  assert.strictEqual(Ascend.ascendCost(it, { plus: 9 }).error, "plus");
  assert.deepStrictEqual(Ascend.ascendCost(it, { plus: 10 }).needs, { selo_dominio: 10 });
  assert.strictEqual(Ascend.ascendCost(it, { plus: 10, ascended: true }).error, "ascended");
  assert.strictEqual(Ascend.ascendCost(Items.GEAR_BY_ID.get("po_refino"), { plus: 10 }).error, "item");
});

test("E14 — Despertar: depois da Ascensão, tier Essências + tier Selos; fatia 0,05 na chave principal pelo peso do slot", () => {
  const it = Items.GEAR_BY_ID.get("linha_garras_lunares");
  assert.strictEqual(Ascend.awakenCost(it, { ascended: false }).error, "notascended");
  assert.deepStrictEqual(Ascend.awakenCost(it, { ascended: true }).needs, { essencia_primordial: 5, selo_dominio: 5 });
  assert.strictEqual(Ascend.awakenCost(it, { ascended: true, awakened: true }).error, "awakened");
  const v = Ascend.awakenValue(it);
  assert.ok(near(v.dmg, B.CAP.dmg * 0.05 * B.WEIGHT.dmg.weapon));
  const plain = Gear.gearBonus({ weapon: { id: it.id, level: 10, grade: 1 } });
  const awake = Gear.gearBonus({ weapon: { id: it.id, level: 10, grade: 1, awakened: true } });
  assert.ok(near(awake.dmg - plain.dmg, v.dmg, 1e-4));
});

test("E14 — todos os slots de uma chave despertos = a fatia inteira (I3 continua no teto)", () => {
  for (const k of B.KEYS) {
    let sum = 0;
    for (const slot of Object.keys(B.WEIGHT[k])) sum += Ascend.awakenValue({ slot, tier: 6, keys: [k, k], rarity: "mythic" })[k];
    assert.ok(near(sum, B.sourceCap(k, "awaken"), 1e-9), k);
  }
});
