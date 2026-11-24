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

/** O que entrou nas tabelas de antes depois da E3 (E9: Pedra; E17: o resto), sempre no fim da lista. */
const NOVOS = new Set(["pedra_aprimoramento", "po_forja", "brasa_solar", "frag_primeira_chama", "minerio_prata", "minerio_ferro", "madeira_ancestral",
  "barro_primordial", "frag_cajado_moldes", "receita_primeira_chama", "receita_cajado_moldes", "ficha_paint", "ficha_jetpack", "ficha_noturno", "ficha_corrida", "ficha_gincana"]);

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

test("E3 + weapon-v1: a fachada antiga (rollLoot) sorteia o mesmo que a tabela da família", () => {
  for (const family of Object.keys(Gear.LOOT)) {
    for (let i = 0; i < 2000; i++) {
      const ctx = { win: i % 3 !== 0, activeMs: (i % 17) * 37000 };
      const agora = Items.rollTable(Items.FAMILY_TABLE[family], ctx, seeded(i * 7919 + family.length));
      assert.deepEqual(Gear.rollLoot(family, ctx, seeded(i * 7919 + family.length)), agora, `${family} #${i}`);
      for (const x of agora) assert.ok(!Items.GEAR_BY_ID.get(x.id).retired, `${family}: ${x.id} aposentado`);
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
  for (const it of Items.GEAR.filter((g) => !g.retired)) assert.ok(Items.sourcesOf(it).length > 0, it.id); // weapon-v1: aposentado não tem origem
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
  // weapon-v1 (24/11): Pó D garantido por minuto, Pó C e fragmentos de classe baixos por chance
  assert.deepEqual(e.po_ref_d, { expected: 3, min: 3, max: 3 });
  assert.equal(e.po_ref_c.expected, 0.35);
  assert.equal(e.frag_classe_e.expected, 0.75);
  assert.equal(e.frag_classe_legendary.min, 0);
  const lost = Items.lootExpectation("fight:laminas", { win: false, activeMs: 240000 });
  assert.deepEqual(Object.keys(lost), ["po_ref_d", "po_ref_e", "frag_oleo_lamina"]); // E17: o Pó de Forja garantido (24/11: o fragmento do Óleo de Lâmina) · weapon-v2: o Pó E
});
