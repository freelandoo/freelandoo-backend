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
/**
 * JSON de agora sem os campos novos dos ITENS: `tier` (E1) e `slot`/`twoHanded` (E6, os 8 slots).
 * Montagem já tinha `tier`; só sai o de quem tem `rarity`.
 */
const NOVOS = new Set(["tier", "slot", "twoHanded", "keys", "transmutable"]); // E11: `transmutable`
/** E7: o `bonus` do equipamento passou a sair da régua (rules/bonus.js) — sai da comparação. */
const semTier = (v) => JSON.parse(JSON.stringify(v, function (k, x) {
  if (typeof this.rarity !== "string") return x;
  if (NOVOS.has(k)) return undefined;
  if (k === "bonus" && ["weapon", "shield", "armor", "accessory"].includes(this.category)) return undefined;
  return x;
}));
/** As peças de antes (os conjuntos da E7 e as linhas/fragmentos/materiais da E8 entram no fim). */
const IDS_ANTES = new Set(ANTES.publicGear.items.map((i) => i.id));
const deAntes = (list) => list.filter((g) => IDS_ANTES.has(g.id));

test("E1: publicGear() é igual ao de antes, campo a campo (fora o tier)", () => {
  const agora = semTier(Gear.publicGear());
  assert.deepEqual(Object.keys(agora).filter((k) => k !== "sets" && k !== "salvage"), Object.keys(ANTES.publicGear)); // E7 `sets`, E11 `salvage` // E7 acrescentou `sets`
  // E6 (A4): os 5 slots de antes viraram os 8 do pedido
  assert.deepEqual(ANTES.publicGear.slots, ["weapon", "shield", "armor", "acc1", "acc2"]);
  assert.deepEqual(agora.slots, ["weapon", "offhand", "helm", "chest", "gloves", "boots", "amulet", "relic"]);
  // E4 (A12) acrescentou as chaves hp/acc/spd/int/dex ao teto; as 5 de antes não mudam
  assert.deepEqual(Object.fromEntries(Object.keys(ANTES.publicGear.cap).map((k) => [k, agora.cap[k]])), ANTES.publicGear.cap);
  assert.deepEqual(Object.keys(agora.cap).filter((k) => !(k in ANTES.publicGear.cap)), ["hp", "acc", "spd", "int", "dex"]);
  // E9 (A2): o refino sorteado +0…+10 virou o aprimoramento garantido +0…+15
  assert.equal(ANTES.publicGear.upgrade.rulesVersion, "forge-v1");
  assert.deepEqual(agora.upgrade, { max: 15, ascendFrom: 11, stone: "pedra_aprimoramento", rulesVersion: "forge-v2" });
  assert.deepEqual(agora.salvage, { share: 0.35, confirmTier: 3, transmuteIn: 3, transmuteCoins: 20 }); // E11
  agora.items = deAntes(agora.items);
  assert.deepEqual(agora.items.map((i) => i.id), ANTES.publicGear.items.map((i) => i.id), "mesma ordem de itens");
  // E9: o texto de uso do refino mudou junto com a regra (e todo equipamento passou a aprimorar)
  const V1 = ["Refinar de +0 a +10 mediante proposta, com custo, pisos e proteção opcionais.", "Custo de refinamento ou proteção; a cotação informa a quantidade exata."];
  const V2 = "Aprimorar de +0 a +15 com custo fixo, sempre subindo; do +11 em diante, depois da Ascensão.";
  // E11: desmontar e transmutar entram nos usos de todo equipamento e material
  const E11 = ["Desmontar na Forja: devolve parte dos materiais e Pó de Refino, nunca Esmeralda.", "Transmutar na Forja: 3 viram 1 de outro material do mesmo tier."];
  const usesV1 = (uses) => (uses || []).filter((u) => !V1.includes(u) && u !== V2 && !E11.includes(u));
  semTier(ANTES.publicGear.items).forEach((antes, n) => assert.deepEqual({ ...agora.items[n], uses: usesV1(agora.items[n].uses) }, { ...antes, uses: usesV1(antes.uses) }, antes.id));
  // E8: as receitas por fragmento entram no fim; as de antes não mudam
  assert.deepEqual(agora.recipes.slice(0, ANTES.publicGear.recipes.length), ANTES.publicGear.recipes);
  assert.ok(agora.recipes.slice(ANTES.publicGear.recipes.length).every((r) => r.kind === "fragment"));
});

test("E1: GEAR, saque e constantes de equipamento iguais aos de antes", () => {
  assert.deepEqual(semTier(deAntes(Gear.GEAR)), semTier(ANTES.gear.GEAR));
  assert.deepEqual(semTier(Gear.UPGRADE), ANTES.gear.UPGRADE, "UPGRADE");
  for (const [k, v] of Object.entries(ANTES.gear.GEAR_CAP)) assert.equal(Gear.GEAR_CAP[k], v, "GEAR_CAP." + k);
  // E2 (mig 446) subiu a pilha de propósito: 999 → 9.999 (objetivo da fatia, §8 E2).
  assert.equal(ANTES.gear.STACK_MAX, 999);
  assert.equal(Gear.STACK_MAX, 9999);
  assert.deepEqual(semTier(Gear.LOOT), ANTES.loot);
});

test("E1: a forja (peças, montagens, conversões e refino) igual à de antes", () => {
  for (const [k, v] of Object.entries(ANTES.forge)) assert.deepEqual(semTier(Forge[k]), v, k);
});

test("E1: fachadas mantêm os mesmos exports", () => {
  // E6 acrescentou LEGACY_SLOTS e normalizeSlot; os de antes continuam todos
  assert.deepEqual(Object.keys(Gear).filter((k) => !["LEGACY_SLOTS", "normalizeSlot"].includes(k)), ["SLOTS", "CATEGORIES", "RARITIES", "GEAR_CAP", "UPGRADE", "STACK_MAX", "GEAR", "GEAR_BY_ID", "LOOT", "RECIPES", "RECIPE_BY_ID", "starterOf", "slotsFor", "canEquip", "gearBonus", "upgradeCost", "rollLoot", "itemDetails", "publicGear"]);
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
