// 24/11/2026 (Alex, "quero tudo pra poder comprar"): toda proteção está à venda (Forjador), pelo preço da classe.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const I = require("../../src/utils/mmItems");
const { PRICE } = require("../../src/utils/mmItems/rules/classStats");

test("toda proteção (elmo, peitoral, luvas, botas) tem preço e fica fora das prateleiras de armas", () => {
  const prot = I.GEAR.filter((g) => g.category === "armor" && !g.retired);
  assert.ok(prot.length >= 64, "52 novas + 12 dos Domínios + as de antes");
  for (const g of prot) {
    assert.ok(g.price > 0, g.id + " sem preço");
    assert.equal(g.shop ?? null, null, g.id + " numa prateleira de armas");
  }
});

test("as 52 novas custam o preço da classe e reciclar não paga (sem lucro com a Forja)", () => {
  for (const p of I.PROTECTIONS.FORGEABLE) {
    const g = I.GEAR_BY_ID.get(p.id);
    if (!g || !/_(elmo|peitoral|luvas|botas)$/.test(g.id) || /^(vigilia|forja|sentinela)_/.test(g.id)) continue;
    assert.equal(g.price, PRICE[g.rank], g.id);
    assert.equal(g.sell, 0, g.id);
  }
});
