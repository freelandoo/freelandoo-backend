"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Gear = require("../../src/utils/meuMundoGear");
const Forge = require("../../src/utils/meuMundoForge");

const sword = Gear.GEAR_BY_ID.get("espada_eter");
const armor = Gear.GEAR_BY_ID.get("colete_couro");
const legacyIds = [
  "espada_aprendiz", "cajado_aprendiz", "espada_latao", "cajado_latao", "espada_eter", "cajado_eter",
  "colete_couro", "couraca_rebitada", "relogio_bolso", "luvas_precisao", "amuleto_aurion",
  "fragmento_lamina", "nucleo_eter", "selo_forja", "couro_reforcado", "rebite", "pigmento_eter",
  "mola_precisao", "injetor_vapor", "capacitor", "rolamento", "receita_eter", "cristal_morkhan", "pintura_arma_eter",
];

test("catálogo preserva os 24 IDs e define 97 itens com fonte e uso reais", () => {
  const pub = Gear.publicGear();
  assert.equal(pub.items.length, 97);
  assert.equal(new Set(pub.items.map((i) => i.id)).size, 97);
  for (const id of legacyIds) assert.ok(Gear.GEAR_BY_ID.has(id), id);
  for (const item of pub.items) {
    assert.ok(item.description?.trim(), item.id);
    assert.ok(item.source.length > 0 && item.source.every((s) => s.trim()), item.id);
    assert.ok(item.uses.length > 0 && item.uses.every((s) => s.trim()), item.id);
    if (item.category === "quest") assert.equal(item.use, "inspect_quest");
    if (item.category === "recipe") assert.equal(item.use, "learn_recipe");
  }
  assert.equal(Gear.GEAR_BY_ID.get("emote_saudacao").use, "unlock_emote");
  assert.equal(Gear.GEAR_BY_ID.get("pintura_arma_eter").use, "apply_weapon_cosmetic");
});

test("cada montagem usa uma unidade de 10/12/15 partes diferentes", () => {
  assert.equal(Forge.COMPONENTS.length, 19);
  assert.equal(Forge.ASSEMBLIES.length, 6);
  for (const family of ["espada", "cajado"]) {
    for (const [tier, size] of [[1, 10], [2, 12], [3, 15]]) {
      const assembly = Forge.ASSEMBLIES.find((a) => a.family === family && a.tier === tier);
      assert.ok(assembly);
      assert.equal(assembly.qty, 1);
      assert.equal(Object.keys(assembly.needs).length, size);
      assert.ok(Object.values(assembly.needs).every((qty) => qty === 1));
      assert.equal(new Set(assembly.parts).size, size);
      for (const id of assembly.parts) assert.ok(Gear.GEAR_BY_ID.get(id).component, id);
      assert.equal(Gear.GEAR_BY_ID.get(assembly.out).price, null, "compra barata não contorna a montagem");
    }
  }
  assert.deepEqual(Forge.assemblyParts("outra", 1), []);
});

test("receitas têm referências válidas, fabricam uma unidade e não geram lucro de reciclagem", () => {
  assert.equal(Gear.RECIPES.length, 55);
  assert.equal(new Set(Gear.RECIPES.map((r) => r.id)).size, Gear.RECIPES.length);
  for (const r of Gear.RECIPES) {
    const out = Gear.GEAR_BY_ID.get(r.out);
    assert.ok(out, r.id);
    assert.equal(r.qty ?? 1, 1, r.id);
    assert.ok(Number.isInteger(r.coins) && r.coins >= 0, r.id);
    let liquidationCost = r.coins;
    if (r.recipe) assert.equal(Gear.GEAR_BY_ID.get(r.recipe)?.category, "recipe", r.id);
    for (const [id, qty] of Object.entries(r.needs)) {
      assert.ok(Gear.GEAR_BY_ID.has(id), r.id + ": " + id);
      assert.ok(Number.isInteger(qty) && qty > 0, r.id);
      liquidationCost += Gear.GEAR_BY_ID.get(id).sell * qty;
    }
    assert.ok(liquidationCost >= out.sell, r.id + " não permite arbitragem de reciclagem");
  }
  for (const component of Forge.COMPONENTS) {
    const r = Forge.PART_RECIPES.find((x) => x.out === component.id);
    assert.ok(r && r.qty === 1);
  }
});

test("todas as receitas e peças são alcançáveis sem depender de sorte rara", () => {
  const reachable = new Set(Gear.GEAR.filter((g) => g.starter || g.price != null).map((g) => g.id));
  for (const loot of Object.values(Gear.LOOT)) reachable.add(loot.base);
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of Gear.RECIPES) {
      if ((!r.recipe || reachable.has(r.recipe)) && Object.keys(r.needs).every((id) => reachable.has(id)) && !reachable.has(r.out)) {
        reachable.add(r.out);
        changed = true;
      }
    }
  }
  assert.deepEqual(Gear.GEAR.filter((g) => !reachable.has(g.id)).map((g) => g.id), []);
  for (const item of Gear.GEAR.filter((g) => g.category === "material")) {
    assert.ok(Gear.RECIPES.some((r) => r.needs[item.id]) || ["fragmento_lamina", "couro_reforcado", "nucleo_eter", "selo_forja"].includes(item.id), item.id);
  }
  assert.ok(Forge.CONVERSIONS.some((r) => r.out === "selo_forja"));
  assert.ok(!Gear.RECIPES.some((r) => r.needs.chave_subestacao), "chave é leitura/coleção, não loot genérico");
});

test("cotação e custo crescem até +10; os primeiros custos monetários permanecem", () => {
  assert.deepEqual(Forge.COINS.slice(0, 5), [120, 220, 380, 600, 900]);
  for (let lv = 0; lv < 10; lv++) {
    const q = Forge.quote(sword, lv);
    assert.equal(q.from, lv);
    assert.equal(q.toMax, lv + 1);
    assert.equal(q.rulesVersion, Forge.RULES_VERSION);
    assert.equal(q.proposalTTLms, 900000);
    assert.equal(q.cost.coins, Forge.COINS[lv]);
    assert.equal(q.cost.needs.fragmento_lamina, Forge.MATERIALS[lv]);
    assert.ok(Math.abs(q.odds.up + q.odds.same + q.odds.down - 1) < 1e-12);
    if (lv) assert.ok(q.cost.coins > Forge.quote(sword, lv - 1).cost.coins);
  }
  assert.equal(Forge.quote(armor, 4).cost.needs.couro_reforcado, Forge.MATERIALS[4]);
  for (const invalid of [-1, 0.5, 10, Infinity, NaN]) assert.equal(Forge.quote(sword, invalid), null);
  assert.equal(Forge.quote(Gear.GEAR_BY_ID.get("luvas_precisao"), 0), null);
});

test("pisos +0/+3/+6 absorvem perda; demais níveis podem cair somente um", () => {
  for (const lv of [0, 3, 6]) {
    const q = Forge.quote(sword, lv);
    assert.equal(q.floor, lv);
    assert.equal(q.odds.down, 0);
    assert.equal(Forge.roll(q, () => 0.999999), lv);
  }
  for (const lv of [1, 2, 4, 5, 7, 8, 9]) {
    const q = Forge.quote(sword, lv);
    assert.equal(Forge.roll(q, () => 0), lv + 1);
    assert.equal(Forge.roll(q, () => q.odds.up), lv);
    assert.equal(Forge.roll(q, () => 0.999999), lv - 1);
  }
});

test("pity garante subida após três resultados sem avanço", () => {
  for (const lv of [0, 2, 3, 5, 6, 9]) {
    const q = Forge.quote(sword, lv, { failures: 3 });
    assert.equal(q.pity.guaranteed, true);
    assert.deepEqual(q.odds, { up: 1, same: 0, down: 0 });
    assert.equal(Forge.roll(q, () => 0.999999), lv + 1);
  }
  assert.equal(Forge.quote(sword, 9, { failures: 2 }).pity.guaranteed, false);
});

test("proteção está no custo total e não cobra no piso ou pity garantido", () => {
  for (const [lv, surcharge] of [[1, 1], [4, 2], [7, 3]]) {
    const plain = Forge.quote(sword, lv);
    const q = Forge.quote(sword, lv, { protected: true });
    assert.equal(q.protection.enabled, true);
    assert.equal(q.cost.needs.selo_forja, (plain.cost.needs.selo_forja || 0) + surcharge);
    assert.equal(q.protection.cost.needs.selo_forja, surcharge);
    assert.equal(q.odds.down, 0);
    assert.equal(Forge.roll(q, () => 0.999999), lv);
  }
  for (const options of [{ protected: true, failures: 3 }, { protected: true }]) {
    const q = Forge.quote(sword, options.failures ? 8 : 6, options);
    assert.equal(q.protection.enabled, false);
    assert.deepEqual(q.protection.cost.needs, {});
  }
});

test("sorteio puro rejeita RNG inválido; resultado vem de uma única amostra", () => {
  const q = Forge.quote(sword, 5);
  for (const bad of [-1, 1, NaN, Infinity]) assert.throws(() => Forge.roll(q, () => bad), RangeError);
  let calls = 0;
  Forge.roll(q, () => { calls += 1; return 0.1; });
  assert.equal(calls, 1);
});

test("refino +6..10 permanece útil e os bônus obedecem aos tetos", () => {
  const legacy = Gear.gearBonus({ weapon: { id: "espada_eter", level: 5 } });
  const high = Gear.gearBonus({ weapon: { id: "espada_eter", level: 10 } });
  assert.equal(legacy.dmg, 0.2);
  assert.equal(high.dmg, 0.3);
  assert.ok(high.stam > legacy.stam && high.warn > legacy.warn && high.power > legacy.power);
  const max = Gear.gearBonus({ weapon: { id: "espada_solar", level: 10 }, armor: { id: "couraca_rebitada", level: 10 }, acc1: { id: "amuleto_aurion" }, acc2: { id: "bracelete_isolante" } });
  for (const [key, cap] of Object.entries(Gear.GEAR_CAP)) assert.ok(max[key] <= cap, key);
});
