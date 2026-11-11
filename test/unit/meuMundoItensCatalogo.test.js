// Trilha E, fatia E1 — o catálogo saiu de meuMundoGear.js/meuMundoForge.js para mmItems/ SEM mudar
// nenhum número, nome, texto, receita ou ordem. O fixture foi gravado com o código de ANTES da mudança.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const Gear = require("../../src/utils/meuMundoGear");
const Forge = require("../../src/utils/meuMundoForge");
const Items = require("../../src/utils/mmItems");
const { TIER } = require("../../src/utils/mmItems/rules/budget");

const ANTES = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "gear-antes.json"), "utf8"));
/** JSON de agora sem o campo novo `tier` dos ITENS (o único acréscimo da E1; montagem já tinha `tier`). */
const semTier = (v) => JSON.parse(JSON.stringify(v, function (k, x) { return k === "tier" && typeof this.rarity === "string" ? undefined : x; }));

test("E1: publicGear() é igual ao de antes, campo a campo (fora o tier)", () => {
  const agora = semTier(Gear.publicGear());
  assert.deepEqual(Object.keys(agora), Object.keys(ANTES.publicGear));
  assert.deepEqual(agora.slots, ANTES.publicGear.slots);
  assert.deepEqual(agora.cap, ANTES.publicGear.cap);
  assert.deepEqual(agora.upgrade, ANTES.publicGear.upgrade);
  assert.deepEqual(agora.items.map((i) => i.id), ANTES.publicGear.items.map((i) => i.id), "mesma ordem de itens");
  ANTES.publicGear.items.forEach((antes, n) => assert.deepEqual(agora.items[n], antes, antes.id));
  assert.deepEqual(agora.recipes, ANTES.publicGear.recipes);
});

test("E1: GEAR, saque e constantes de equipamento iguais aos de antes", () => {
  assert.deepEqual(semTier(Gear.GEAR), ANTES.gear.GEAR);
  for (const k of ["SLOTS", "GEAR_CAP", "UPGRADE"]) assert.deepEqual(semTier(Gear[k]), ANTES.gear[k], k);
  // E2 (mig 446) subiu a pilha de propósito: 999 → 9.999 (objetivo da fatia, §8 E2).
  assert.equal(ANTES.gear.STACK_MAX, 999);
  assert.equal(Gear.STACK_MAX, 9999);
  assert.deepEqual(semTier(Gear.LOOT), ANTES.loot);
});

test("E1: a forja (peças, montagens, conversões e refino) igual à de antes", () => {
  for (const [k, v] of Object.entries(ANTES.forge)) assert.deepEqual(semTier(Forge[k]), v, k);
});

test("E1: fachadas mantêm os mesmos exports", () => {
  assert.deepEqual(Object.keys(Gear), ["SLOTS", "CATEGORIES", "RARITIES", "GEAR_CAP", "UPGRADE", "STACK_MAX", "GEAR", "GEAR_BY_ID", "LOOT", "RECIPES", "RECIPE_BY_ID", "starterOf", "slotsFor", "canEquip", "gearBonus", "upgradeCost", "rollLoot", "itemDetails", "publicGear"]);
  assert.deepEqual(Object.keys(Forge), ["RULES_VERSION", "MAX_LEVEL", "PROPOSAL_TTL_MS", "COINS", "MATERIALS", "NUCLEI", "SEALS", "SECONDARY_PER_LEVEL", "COMPONENTS", "ASSEMBLIES", "CONVERSIONS", "PART_RECIPES", "assemblyParts", "quote", "roll"]);
  assert.equal(Gear.GEAR_BY_ID.size, Gear.GEAR.length);
  assert.equal(Gear.RECIPE_BY_ID.size, Gear.RECIPES.length);
});

test("E1: validateCatalog() sem erro", () => {
  assert.deepEqual(Items.validateCatalog(), []);
});

test("E1: mítica, tier e categorias novas aceitas", () => {
  assert.deepEqual(Gear.RARITIES, ["common", "uncommon", "rare", "epic", "legendary", "mythic"]);
  for (const c of ["offhand", "relic", "fragment", "rune", "consumable", "currency"]) assert.ok(Gear.CATEGORIES.includes(c), c);
  for (const g of Gear.GEAR) assert.equal(g.tier, TIER[g.rarity], g.id);
  for (const i of Gear.publicGear().items) assert.ok(i.tier >= 1 && i.tier <= 6, i.id);
});

test("E1: validateCatalog() pega os erros de catálogo", () => {
  const { validateCatalog } = require("../../src/utils/mmItems/validate");
  const base = { category: "material", rarity: "common", tier: 1, name: "x" };
  const src = () => ["teste"];
  const e = validateCatalog({
    items: [
      { id: "a", ...base }, { id: "a", ...base },
      { id: "f", ...base, category: "fragment" },
      { id: "g", ...base, category: "fragment", fragment: { of: "nada", need: 60 } },
      { id: "m", ...base, rarity: "mythic", tier: 5 },
      { id: "k", ...base, category: "weapon", slot: "weapon", keys: ["dmg", "spd"] },
    ],
    recipes: [{ id: "r", out: "zzz", needs: { yyy: 1 } }],
    sets: [{ id: "s", pieces: ["a", "a", "a"] }],
    sources: (it) => (it.id === "m" ? [] : src()),
  });
  for (const pedaco of ["id repetido: a", "f: fragmento sem alvo", "g: fragmento aponta nada", "m: tier 5", "k: keys", "saída zzz", "ingrediente yyy", "conjunto s", "m: sem origem"]) {
    assert.ok(e.some((x) => x.includes(pedaco)), `faltou erro: ${pedaco} em ${JSON.stringify(e)}`);
  }
  assert.deepEqual(validateCatalog({ items: [{ id: "k", ...base, category: "weapon", slot: "weapon", keys: ["dmg", "acc"] }], sources: src }), []);
});
