// test/unit/meuMundoDominioSaque.test.js — trilha E, fatia E12: o Domínio como masmorra.
// As 60 tabelas `domain:<id>:<setor>` seguem as contas do GDD (tabela L) e o "onde conseguir"
// dos itens que passaram a cair sai das tabelas, sem origem declarada.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Items = require("../../src/utils/mmItems");
const Loot = require("../../src/utils/mmItems/catalog/loot");

const DOMAINS = ["floresta", "canion", "gelo", "fabrica", "vulcao", "orbital"];
const seeded = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

test("E12: 10 setores por Domínio, todos com itens que existem", () => {
  for (const d of DOMAINS) {
    for (let s = 1; s <= 10; s++) {
      const id = `domain:${d}:${s}`;
      const t = Items.LOOT_TABLES[id];
      assert.ok(t, id);
      assert.equal(Items.domainTableId(d, s), id);
      for (const e of [...t.sure, ...t.chance, ...(t.first || [])]) assert.ok(Items.GEAR_BY_ID.has(e.id), `${id}: ${e.id}`);
    }
    assert.equal(Items.domainTableId(d, 11), null);
  }
  assert.equal(Items.domainTableId("nada", 1), null);
});

test("E12: contas do GDD — comum 1 + ⌊s/3⌋, raro 5% + 3%·s, Lingote 4+, Catalisador 8+, chefão no 10", () => {
  for (const d of DOMAINS) {
    const { common, rare } = Loot.DOMAIN_MATS[d];
    assert.equal(Items.GEAR_BY_ID.get(common).rarity, "common", common);
    assert.equal(Items.GEAR_BY_ID.get(rare).rarity, "rare", rare);
    for (let s = 1; s <= 10; s++) {
      const e = Items.lootExpectation(`domain:${d}:${s}`, { win: true });
      assert.deepEqual(e[common], { expected: 1 + Math.floor(s / 3), min: 1 + Math.floor(s / 3), max: 1 + Math.floor(s / 3) }, `${d} ${s}`);
      if (s < 10) assert.equal(e[rare].expected, Math.round((0.05 + 0.03 * s) * 1000) / 1000, `${d} ${s} raro`);
      else assert.equal(e[rare].min, 1, `${d} chefão: raro garantido`);
      assert.equal(e.pedra_aprimoramento.expected, 0.5);
      assert.equal(!!e.lingote_refinado, s >= 4, `${d} ${s} lingote`);
      assert.equal(!!e.catalisador_refino, s >= 8, `${d} ${s} catalisador`);
      assert.equal(!!e.selo_dominio, s === 10, `${d} ${s} selo`);
      assert.equal(!!e.essencia_primordial, s === 10, `${d} ${s} essência`);
    }
    // chefão: 3 a 5 fragmentos da arma de linha + 1 Selo; na primeira, +10 e a receita
    const line = Items.LINES.LINES.find((l) => l.region === d);
    const boss = Items.lootExpectation(`domain:${d}:10`, { win: true });
    assert.deepEqual([boss[`frag_${line.key}`].min, boss[`frag_${line.key}`].max], [3, 5]);
    assert.deepEqual(boss.selo_dominio, { expected: 1, min: 1, max: 1 });
    const first = Items.lootExpectation(`domain:${d}:10`, { win: true, first: true });
    assert.deepEqual([first[`frag_${line.key}`].min, first[`frag_${line.key}`].max], [13, 15]);
    assert.equal(first[`receita_${line.key}`].min, 1);
    // nenhum fragmento de deus (A1 é do Alex)
    for (let s = 1; s <= 10; s++) {
      const t = Items.LOOT_TABLES[`domain:${d}:${s}`];
      for (const x of [...t.sure, ...t.chance, ...(t.first || [])]) assert.ok(!x.id.startsWith("frag_deus"), x.id);
    }
  }
  // conjunto: projeto na primeira vitória do 7, fragmento 2 a 3 do 7 ao 10
  for (const set of Items.LINES.FRAGMENT_SETS) {
    assert.equal(Items.lootExpectation(`domain:${set.domain}:7`, { win: true, first: true })[`projeto_${set.id}`].min, 1);
    assert.equal(Items.lootExpectation(`domain:${set.domain}:8`, { win: true, first: true })[`projeto_${set.id}`], undefined);
  }
});

test("E12: o Domínio paga por vitória — a derrota não sorteia nada da tabela do setor", () => {
  for (const d of DOMAINS) for (let s = 1; s <= 10; s++) {
    const R = seeded(s * 31 + d.length);
    for (let i = 0; i < 50; i++) assert.deepEqual(Items.rollTable(`domain:${d}:${s}`, { win: false, activeMs: 600000 }, R), [], `${d} ${s}`);
  }
});

test("E12: a primeira vitória só paga com `first`; sem ela nunca sai receita nem projeto", () => {
  const R = seeded(7);
  for (let i = 0; i < 300; i++) {
    const ids = Items.rollTable("domain:floresta:10", { win: true }, R).map((x) => x.id);
    assert.ok(!ids.includes("receita_garras_lunares"));
    assert.ok(ids.includes("selo_dominio") && ids.includes("frag_garras_lunares") && ids.includes("seiva_de_prata"));
  }
  const firstIds = Items.rollTable("domain:floresta:10", { win: true, first: true }, R);
  assert.ok(firstIds.find((x) => x.id === "receita_garras_lunares"));
  assert.ok(firstIds.find((x) => x.id === "frag_garras_lunares").qty >= 13);
});

test("E12: pior caso do material comum perto do esperado (§6.6) — Vigília: Pó de Lua e Seiva", () => {
  // a Vigília pede 12 Pó de Lua + 1 Seiva por peça: nos setores 7 a 10 o Pó sai antes dos fragmentos
  for (let s = 7; s <= 10; s++) {
    const e = Items.lootExpectation(`domain:floresta:${s}`, { win: true });
    assert.ok(Math.ceil(48 / e.po_de_lua.min) <= 40, `setor ${s}`);
  }
});

test("E12: itens que passaram a cair perderam a origem declarada e mostram a tabela", () => {
  const caem = new Set();
  for (const [id, t] of Object.entries(Items.LOOT_TABLES)) if (t.domain) for (const e of [...t.sure, ...t.chance, ...(t.first || [])]) caem.add(e.id);
  for (const id of caem) {
    const g = Items.GEAR_BY_ID.get(id);
    assert.ok(!Array.isArray(g.source), `${id} ainda declara source`);
    const src = Items.sourcesOf(g);
    assert.ok(src.some((x) => /Domínio/.test(x)), `${id}: ${JSON.stringify(src)}`);
  }
  // o que ainda espera a E17 segue declarado
  for (const id of ["minerio_ferro", "brasa_solar", "frag_primeira_chama", "receita_lamina_correntes"]) assert.ok(Array.isArray(Items.GEAR_BY_ID.get(id).source), id);
  // agrupado: a Pedra não vira 60 linhas
  assert.ok(Items.sourcesOf(Items.GEAR_BY_ID.get("pedra_aprimoramento")).length <= 4);
  assert.deepEqual(Items.sourcesOf(Items.GEAR_BY_ID.get("po_de_lua")), ["Domínio Floresta da Lua: garantido em todo setor (1 a 4 por vitória)."]);
});
