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
