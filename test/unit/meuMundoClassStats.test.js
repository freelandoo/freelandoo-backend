// Status da classe de raridade (rules/classStats.js, decisão do Alex 2026-11-17).
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const CS = require("../../src/utils/mmItems/rules/classStats");
const { RANKS } = require("../../src/utils/mmItems/rules/rank");
const { GEAR } = require("../../src/utils/mmItems");

test("escada: dobro da E até a A, triplo do S para cima, sem teto", () => {
  for (let i = 1; i < RANKS.length; i++) {
    const k = i <= 4 ? 2 : 3;
    assert.equal(CS.NUMBER[RANKS[i]], CS.NUMBER[RANKS[i - 1]] * k, RANKS[i]);
    assert.ok(Math.abs(CS.PERCENT[RANKS[i]] - CS.PERCENT[RANKS[i - 1]] * k) < 1e-9, RANKS[i]);
  }
  assert.equal(CS.NUMBER.E, 5);
  assert.equal(CS.PERCENT.E, 0.1);
  assert.equal(CS.NUMBER.divine, 19440);
});

test("cada divisão soma 1 e só usa status conhecidos", () => {
  for (const [kind, { n, p }] of Object.entries(CS.SPLIT)) {
    const sn = Object.values(n).reduce((a, b) => a + b, 0);
    const sp = Object.values(p).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sn - 1) < 1e-9 && Math.abs(sp - 1) < 1e-9, kind);
    assert.ok(Object.keys(n).length <= 3 && Object.keys(p).length <= 3, kind);
    for (const k of Object.keys(n)) assert.ok(CS.FLAT_KEYS.includes(k), `${kind}.${k}`);
    for (const k of Object.keys(p)) assert.ok(CS.PCT_KEYS.includes(k), `${kind}.${k}`);
  }
});

test("espada do Alex: acerto 40 · força 40 · esquiva 20 no número; dano 50 · força 50 na %", () => {
  const s = CS.classStatsOf({ id: "x", slot: "weapon", shop: "weapons", rank: "SSR" });
  assert.equal(s.kind, "sword");
  assert.deepEqual(Object.keys(s.flat).sort(), ["acc", "atk", "spd"]);
  assert.ok(Math.abs(s.flat.acc - s.number * 0.4) <= 1 && Math.abs(s.flat.spd - s.number * 0.2) <= 1);
  assert.ok(Math.abs(s.pct.dmg - s.percent / 2) < 0.01 && Math.abs(s.pct.atk - s.percent / 2) < 0.01);
  const e = CS.classStatsOf({ id: "y", slot: "offhand", rank: "E" });
  assert.deepEqual(Object.keys(e.flat).sort(), ["def", "hp", "stam"]);
  assert.deepEqual(Object.keys(e.pct).sort(), ["def", "hp"]);
});

test("variação de ±10% fixa pelo id", () => {
  for (const id of ["a", "espada_aco", "linha_primeira_chama", "zzz"]) {
    const k = CS.spreadOf(id);
    assert.ok(k >= 0.9 && k <= 1.1, id);
    assert.equal(k, CS.spreadOf(id));
  }
});

test("catálogo: toda peça equipável tem status e o resto não", () => {
  for (const g of GEAR) {
    if (g.slot) {
      assert.ok(g.stats, g.id);
      assert.equal(g.stats.rank, g.rank, g.id);
      const m = CS.NUMBER[g.rank];
      assert.ok(g.stats.number >= Math.floor(m * 0.9) && g.stats.number <= Math.ceil(m * 1.1), g.id);
    } else assert.equal(g.stats, null, g.id);
  }
});
