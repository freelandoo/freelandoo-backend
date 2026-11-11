// Trilha E, fatia E10 — REFINAMENTO I–V: grau de qualidade por cópia, separado do aprimoramento.
// Contas do plano (§8 E10): o grau V soma exatamente a fatia 0,10 do teto na peça; custo do I ao V por tier.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Items = require("../../src/utils/mmItems");
const B = require("../../src/utils/mmItems/rules/budget");
const U = require("../../src/utils/mmItems/rules/upgrade");

const equipment = Items.GEAR.filter((g) => g.slot && Array.isArray(g.keys));

test("E10: o grau V soma exatamente a fatia 0,10 do teto em cada chave de cada peça", () => {
  assert.ok(equipment.length > 100);
  for (const it of equipment) {
    it.keys.forEach((k, i) => {
      const emphasis = i === 0 ? 1 : B.SECONDARY;
      const slice = B.CAP[k] * B.WEIGHT[k][it.slot] * emphasis * B.SHARE.grade;
      for (const plus of [0, 7, 15]) {
        const g5 = B.pieceParts(k, it.slot, it.rarity, plus, 5, emphasis).grade;
        assert.ok(Math.abs(g5 - slice) < 1e-12, `${it.id} ${k} +${plus}: ${g5} ≠ ${slice}`);
        assert.equal(B.pieceParts(k, it.slot, it.rarity, plus, 1, emphasis).grade, 0, `${it.id} ${k}: grau I não soma`);
      }
    });
  }
});

test("E10: cada grau sobe o bônus da peça, sem mexer no aprimoramento", () => {
  for (const it of equipment) {
    for (const plus of [0, 10]) {
      let prev = null;
      for (let g = 1; g <= 5; g++) {
        const b = Items.pieceBonus(it, plus, g);
        if (prev) for (const k of it.keys) assert.ok(b[k] >= prev[k], `${it.id} +${plus} grau ${g} ${k}`);
        prev = b;
      }
      // o grau não muda a parte do aprimoramento
      for (const k of it.keys) assert.equal(B.pieceParts(k, it.slot, it.rarity, plus, 4).plus, B.pieceParts(k, it.slot, it.rarity, plus, 1).plus);
    }
  }
});

test("E10: custo fixo por grau — Pó de Refino × tier e Catalisador; nunca Esmeralda", () => {
  const sword = { id: "x", slot: "weapon", tier: 1 };
  assert.deepEqual([1, 2, 3, 4].map((g) => U.gradeCost(sword, g).needs), [
    { po_refino: 20, catalisador_refino: 1 }, { po_refino: 50, catalisador_refino: 2 },
    { po_refino: 120, catalisador_refino: 4 }, { po_refino: 300, catalisador_refino: 8 },
  ]);
  assert.deepEqual(U.gradeCost({ ...sword, tier: 6 }, 4).needs, { po_refino: 2700, catalisador_refino: 8 });
  for (let g = 1; g <= 4; g++) assert.equal(U.gradeCost(sword, g).coins, 0);
  assert.equal(U.gradeCost(sword, 5), null, "grau V é o último");
  assert.equal(U.gradeCost(sword, 0), null);
  assert.equal(U.gradeCost(Items.GEAR_BY_ID.get("fragmento_lamina"), 1), null, "material não refina");
  // custo total do I ao V por tier (GDD)
  const totals = Object.fromEntries([1, 2, 3, 4, 5, 6].map((t) => [t, U.gradeTotal({ slot: "weapon", tier: t })]));
  assert.deepEqual(Object.fromEntries(Object.entries(totals).map(([t, v]) => [t, v.po_refino])), { 1: 490, 2: 735, 3: 1225, 4: 1960, 5: 2940, 6: 4410 });
  for (const v of Object.values(totals)) assert.equal(v.catalisador_refino, 15);
});
