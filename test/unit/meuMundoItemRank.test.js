// Classe de raridade dos itens (decisão do Alex, 2026-11-17): E · D · C · B · A · S · SS · SSR · Lendária · Divina.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Items = require("../../src/utils/mmItems");
const Rank = require("../../src/utils/mmItems/rules/rank");

test("rank: a escala tem as 10 classes na ordem do Alex", () => {
  assert.deepEqual(Rank.RANKS, ["E", "D", "C", "B", "A", "S", "SS", "SSR", "legendary", "divine"]);
  assert.equal(Rank.RANK_ORDER.E, 0);
  assert.equal(Rank.RANK_ORDER.divine, 9);
});

test("rank: arma e escudo da loja seguem o nível (1=E … 7–8=SS, 9–10=SSR)", () => {
  const want = { 1: "E", 2: "D", 3: "C", 4: "B", 5: "A", 6: "S", 7: "SS", 8: "SS", 9: "SSR", 10: "SSR" };
  const shop = Items.GEAR.filter((g) => g.shop && !g.line && !(g.rank === "legendary" || g.rank === "divine")); // rank explícito (armas do Tripo, 22/11) vence o nível
  assert.ok(shop.length >= 85, `itens de loja: ${shop.length}`);
  for (const g of shop) assert.equal(g.rank, want[g.level], `${g.id} nv ${g.level}`);
  assert.equal(Rank.rankByLevel(14), "SSR");
});

test("rank: armas dos deuses (linha) são Lendárias; as Divinas são as 11 do Tripo (22/11)", () => {
  const lines = Items.GEAR.filter((g) => g.line);
  assert.equal(lines.length, 9);
  for (const g of lines) assert.equal(g.rank, "legendary", g.id);
  assert.equal(Items.GEAR.filter((g) => g.rank === "divine").length, 11);
});

test("rank: fora da escala de armas, pela raridade interna", () => {
  assert.equal(Items.GEAR_BY_ID.get("colete_couro").rank, "E");
  assert.equal(Items.GEAR_BY_ID.get("amuleto_aurion").rank, "B");
  assert.equal(Items.GEAR_BY_ID.get("embriao_kragor").rank, "legendary");
  assert.equal(Rank.rankByRarity("mythic"), "divine");
  for (const g of Items.GEAR) assert.ok(Rank.RANKS.includes(g.rank), g.id);
});
