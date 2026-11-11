// Trilha E, fatia E3 — saque por tabela nomeada, com porta única.
// Prova: as 7 tabelas dão EXATAMENTE o que o `rollLoot` de antes dava, com o mesmo `R`
// (mesma ordem de sorteios); todo item tem "onde conseguir"; o saque não depende do nível.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const Items = require("../../src/utils/mmItems");
const Gear = require("../../src/utils/meuMundoGear");
const Adv = require("../../src/utils/meuMundoAdventure");

/** A regra de ANTES da E3 (meuMundoGear.rollLoot até a E2), copiada como referência. */
function rollLootAntes(family, { win, activeMs }, R) {
  const t = Gear.LOOT[family];
  if (!t) return [];
  const out = new Map();
  const add = (id, n) => id && n > 0 && out.set(id, (out.get(id) || 0) + n);
  const minutes = Math.max(0, activeMs) / 60000;
  add(t.base, Math.max(1, Math.min(4, Math.round(minutes / 2))) + (win ? 1 : 0));
  if (win && t.uncommon && R() < 0.35) add(t.uncommon, 1);
  if (win && t.rare && R() < 0.06) add(t.rare, 1);
  return [...out.entries()].map(([id, qty]) => ({ id, qty, rarity: Gear.GEAR_BY_ID.get(id).rarity }));
}

/** Sorteio determinístico (mulberry32) que também conta as chamadas. */
function seeded(seed) {
  let a = seed >>> 0;
  const R = () => {
    R.calls++;
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  R.calls = 0;
  return R;
}

test("E3: cada atividade tem a sua tabela e a família de antes aponta a mesma", () => {
  for (const [activity, def] of Object.entries(Adv.ACTIVITIES)) {
    const table = Items.ACTIVITY_TABLE[activity];
    assert.ok(Items.LOOT_TABLES[table], activity);
    assert.equal(Items.FAMILY_TABLE[def.loot], table, activity);
  }
});

test("E3: as tabelas dão o mesmo saque da regra antiga com o mesmo R (10 mil sorteios por família)", () => {
  for (const family of Object.keys(Gear.LOOT)) {
    for (let i = 0; i < 10000; i++) {
      const ctx = { win: i % 3 !== 0, activeMs: (i % 17) * 37000 };
      const A = seeded(i * 7919 + family.length), B = seeded(i * 7919 + family.length);
      const antes = rollLootAntes(family, ctx, A);
      const agora = Items.rollTable(Items.FAMILY_TABLE[family], ctx, B);
      assert.deepEqual(agora, antes, `${family} #${i}`);
      assert.equal(B.calls, A.calls, `${family} #${i}: mesma quantidade de sorteios`);
      assert.deepEqual(Gear.rollLoot(family, ctx, seeded(i * 7919 + family.length)), antes);
    }
  }
});

test("E3: o saque não depende do nível", () => {
  for (const table of Object.keys(Items.LOOT_TABLES)) {
    for (const win of [true, false]) {
      const base = Items.lootExpectation(table, { win, activeMs: 240000, level: 1 });
      for (const level of [5, 30, 100, 500]) assert.deepEqual(Items.lootExpectation(table, { win, activeMs: 240000, level }), base, `${table} ${level}`);
    }
  }
});

test("E3: todo item do catálogo tem 'onde conseguir' não vazio", () => {
  for (const it of Items.GEAR) assert.ok(Items.sourcesOf(it).length > 0, it.id);
  // e todo item de tabela aparece como fonte dele
  for (const [table, t] of Object.entries(Items.LOOT_TABLES)) {
    for (const e of [...(t.sure || []), ...(t.chance || [])]) {
      assert.ok(Items.GEAR_BY_ID.has(e.id), `${table}: ${e.id} existe`);
      assert.ok(Items.lootSourcesOf(e.id).some((s) => s.table === table), `${table}: ${e.id}`);
    }
  }
});

test("E3: esperado por vitória confere com a regra (lâminas, 4 min, vitória)", () => {
  const e = Items.lootExpectation("fight:laminas", { win: true, activeMs: 240000 });
  assert.deepEqual(e.fragmento_lamina, { expected: 3, min: 3, max: 3 });
  assert.equal(e.nucleo_eter.expected, 0.35);
  assert.equal(e.selo_forja.expected, 0.06);
  assert.equal(e.selo_forja.min, 0);
  const lost = Items.lootExpectation("fight:laminas", { win: false, activeMs: 240000 });
  assert.deepEqual(Object.keys(lost), ["fragmento_lamina"]);
});
