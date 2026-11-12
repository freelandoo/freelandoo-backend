// test/unit/meuMundoDominioSaque.test.js — trilha E, fatia E12: o Domínio como masmorra.
// As 60 tabelas `domain:<id>:<setor>` seguem as contas do GDD (tabela L) e o "onde conseguir"
// dos itens que passaram a cair sai das tabelas, sem origem declarada.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Items = require("../../src/utils/mmItems");
const Loot = require("../../src/utils/mmItems/catalog/loot");
const D = require("../../src/utils/meuMundoDomains");
const Gear = require("../../src/utils/meuMundoGear");

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
    // S14 (A1 respondida pelo Alex em 2026-11-12): fragmento do deus só no setor 10 — 1 por vitória, +5 na primeira
    const god = Items.GEAR_BY_ID.get(`frag_deus_${D.BOSS_BY_DOMAIN[d]}`);
    assert.ok(god && god.fragment.need === 100 && god.fragment.of === `embriao_${D.BOSS_BY_DOMAIN[d]}`, d);
    for (let s = 1; s <= 10; s++) {
      const t = Items.LOOT_TABLES[`domain:${d}:${s}`];
      for (const x of [...t.sure, ...t.chance, ...(t.first || [])]) if (x.id.startsWith("frag_deus")) assert.equal(s, 10, x.id);
    }
    assert.deepEqual(boss[god.id], { expected: 1, min: 1, max: 1 });
    assert.equal(first[god.id].min, 6);
    // S14: fragmento de acessório no setor 3 (×1) e no 7 (×1–2), garantido na vitória; 40 fazem o amuleto épico
    const acc = `frag_amuleto_${d}`;
    assert.deepEqual(Items.lootExpectation(`domain:${d}:3`, { win: true })[acc], { expected: 1, min: 1, max: 1 });
    assert.deepEqual([Items.lootExpectation(`domain:${d}:7`, { win: true })[acc].min, Items.lootExpectation(`domain:${d}:7`, { win: true })[acc].max], [1, 2]);
    assert.equal(Items.lootExpectation(`domain:${d}:3`, { win: false })[acc], undefined, "derrota não paga");
    const amu = Items.GEAR_BY_ID.get(`amuleto_${d}`);
    assert.ok(amu && amu.slot === "amulet" && amu.rarity === "epic" && amu.keys.length === 2, d);
    assert.equal(Items.GEAR_BY_ID.get(acc).fragment.need, 40);
    // S14: guardião do setor 9 dá 1 fragmento de personagem por vitória (100 fazem o embrião)
    const g9 = Object.keys(Items.lootExpectation(`domain:${d}:9`, { win: true })).filter((k) => k.startsWith("frag_personagem_"));
    assert.equal(g9.length, 1, d);
    assert.equal(Items.lootExpectation(`domain:${d}:9`, { win: true })[g9[0]].min, 1);
  }
  // S14: elite que é personagem jogável — 25% por vitória nos setores 7 e 8
  for (const [d, id] of [["gelo", "ciborgue"], ["fabrica", "garras"], ["vulcao", "golem"], ["orbital", "cavaleiro"]])
    for (const s of [7, 8]) {
      const e = Items.lootExpectation(`domain:${d}:${s}`, { win: true })[`frag_personagem_${id}`];
      assert.ok(e && e.expected === 0.25 && e.min === 0 && e.max === 1, `${d} ${s}`);
    }
  assert.ok(Items.lootExpectation("domain:vulcao:9", { win: true }).frag_personagem_brutamontes.min === 1, "Brutamontes é o guardião do Vulcão");
  // o embrião ainda não tem uso (Criogenia é a fatia seguinte) e vem da receita de fragmento
  for (const id of ["embriao_selene", "embriao_noctis"]) {
    assert.equal(Items.GEAR_BY_ID.get(id).use, null, id);
    assert.ok(Gear.RECIPES.some((r) => r.kind === "fragment" && r.out === id), id);
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
  // E17: o que esperava a E17 também saiu das tabelas (Arena, rua, minijogos) e perdeu a origem declarada
  for (const id of ["minerio_ferro", "brasa_solar", "frag_primeira_chama", "receita_lamina_correntes"]) assert.ok(!Array.isArray(Items.GEAR_BY_ID.get(id).source) && Items.sourcesOf(Items.GEAR_BY_ID.get(id)).length > 0, id);
  // agrupado: a Pedra não vira 60 linhas
  assert.ok(Items.sourcesOf(Items.GEAR_BY_ID.get("pedra_aprimoramento")).filter((x) => /Domínio/.test(x)).length <= 4); // E17: rua e troca somam linhas fora dos Domínios
  assert.deepEqual(Items.sourcesOf(Items.GEAR_BY_ID.get("po_de_lua")), ["Domínio Floresta da Lua: garantido em todo setor (1 a 4 por vitória)."]);
});
