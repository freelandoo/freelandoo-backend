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

test("catálogo preserva os 24 IDs e define 151 itens com fonte e uso reais (+12 dos conjuntos, E7; +59 da E8; +44 do bestiário, S14; +35 runas da E13; +8 consumíveis da E16; +6 fichas da E17)", () => {
  const pub = Gear.publicGear();
  assert.equal(pub.items.length, 438); // weapon-v2 (24/11): +4 pós (E, SSR, Lendária, Divina; os SSS ficam como aposentados) · weapon-v1 (24/11): +17 espadas, +9 pós, +10 fragmentos de classe · Floresta Vermelha (22/11): +8 · armas do Tripo (22/11): +74 · E19: + ficha de evento (a receita oculta da E18 fica fora do público)
  assert.equal(new Set(pub.items.map((i) => i.id)).size, 438);
  for (const id of legacyIds) assert.ok(Gear.GEAR_BY_ID.has(id), id);
  for (const item of pub.items) {
    assert.ok(item.description?.trim(), item.id);
    // weapon-v1: o aposentado fica no catálogo (recibos e cópias antigas) mas sem origem nenhuma
    if (item.retired) assert.deepEqual(item.source, [], item.id);
    else assert.ok(item.source.length > 0 && item.source.every((s) => s.trim()), item.id);
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
  assert.equal(Gear.RECIPES.length, 33); // weapon-v1 (24/11): ficam só Criogenia/bestiário (25) e preparos (8) · Floresta Vermelha (22/11): +3 (amuleto, 2 embriões) · E8: +21 receitas por fragmento; S14: +22 (6 amuletos, 16 embriões); E16: +8 de preparo; E18: receita oculta
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
  // weapon-v1: nenhuma receita que ficou usa item aposentado
  for (const r of Gear.RECIPES) for (const id of [r.out, ...Object.keys(r.needs)]) assert.ok(!Gear.GEAR_BY_ID.get(id).retired, `${r.id}: ${id}`);
});

test("weapon-v1: tudo que ficou no jogo tem caminho; toda arma monta com fragmento de classe que cai ou se troca", () => {
  const Items = require("../../src/utils/mmItems");
  const WP = require("../../src/utils/mmItems/rules/weaponProgress");
  for (const g of Gear.GEAR.filter((x) => !x.retired && !x.hidden)) assert.ok(Items.sourcesOf(g).length > 0, g.id);
  const obtainable = new Set();
  for (const t of Object.values(Items.LOOT_TABLES)) for (const e of [...(t.sure || []), ...(t.chance || []), ...(t.first || [])]) if (e && e.id) obtainable.add(e.id);
  for (const o of Items.EXCHANGE.OFFERS) for (const id of Object.keys(o.gives)) obtainable.add(id);
  for (const g of Gear.GEAR.filter((x) => WP.isWeapon(x) && !x.retired)) {
    const cost = WP.assemblyCost(g);
    assert.ok(cost && Gear.GEAR_BY_ID.has(cost.fragment), g.id);
    assert.ok(Items.sourcesOf(Gear.GEAR_BY_ID.get(cost.fragment)).length > 0, cost.fragment);
  }
  for (const id of WP.POWDER_IDS) assert.ok(Items.sourcesOf(Gear.GEAR_BY_ID.get(id)).length > 0, id);
  assert.ok(obtainable.has("po_ref_d") && obtainable.has("frag_classe_e"));
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
  // E7: o refino é a fatia de aprimoramento da régua (20% do teto); +10 vale mais que +5 nas duas chaves
  const legacy = Gear.gearBonus({ weapon: { id: "espada_eter", level: 5 } });
  const high = Gear.gearBonus({ weapon: { id: "espada_eter", level: 10 } });
  const [k1, k2] = Gear.GEAR_BY_ID.get("espada_eter").keys;
  assert.ok(high[k1] > legacy[k1] && high[k2] > legacy[k2]);
  const max = Gear.gearBonus({ weapon: { id: "espada_solar", level: 10 }, chest: { id: "couraca_rebitada", level: 10 }, amulet: { id: "amuleto_aurion" }, gloves: { id: "luvas_precisao" } });
  for (const [key, cap] of Object.entries(Gear.GEAR_CAP)) assert.ok(max[key] <= cap, key);
});
