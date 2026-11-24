// test/unit/meuMundoFlorestaVermelha.test.js — 22/11 (pedido do Alex): o 7º Domínio, a Floresta Vermelha de
// Varkos, o Leão da Guerra — o último da travessia e o mais forte.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../../src/utils/meuMundoDomains");
const F = require("../../src/utils/meuMundoFight");
const Items = require("../../src/utils/mmItems");
const Pact = require("../../src/utils/meuMundoPact");

test("Floresta Vermelha: a última da travessia, depois da Orbital, com o treinador 29", () => {
  const d = D.domainOf("vermelha");
  assert.equal(d.index, D.DOMAINS.length - 1, "é a última");
  assert.equal(d.god, "varkos");
  assert.equal(d.need, 29);
  assert.deepEqual(D.lockOf("vermelha", 40, { orbital: 9 }), { code: "crossing", from: "orbital" });
  assert.deepEqual(D.lockOf("vermelha", 28, { orbital: 10 }), { code: "trainer", level: 29 });
  assert.equal(D.lockOf("vermelha", 29, { orbital: 10 }), null);
  const v = D.view(40, { orbital: 10 });
  assert.equal(v.find((x) => x.id === "orbital").passage.to, "vermelha", "a Orbital vencida abre a passagem");
  assert.equal(v.find((x) => x.id === "vermelha").passage, null, "depois dela não há mais Domínio");
  assert.deepEqual(v.find((x) => x.id === "vermelha").scenes.map((c) => c.name), ["vermelha-1", "vermelha-2", "vermelha-3"]);
});

test("Floresta Vermelha: a mais forte — Poder e nível acima de todos, deus Varkos em fases no setor 10", () => {
  const others = D.DOMAIN_IDS.filter((x) => x !== "vermelha");
  for (const id of others) {
    assert.ok(D.recommendedPower("vermelha", 1) > D.recommendedPower(id, 10), id);
    assert.ok(D.sectorLevel("vermelha", 10) > D.sectorLevel(id, 10), id);
  }
  assert.equal(D.bossOf("vermelha", 10), "varkos");
  assert.equal(D.bossOf("vermelha", 9), null);
  assert.deepEqual(D.foeOf("vermelha", 10), { id: "varkos", body: "varkos", rig: true, art: true });
  assert.equal(D.kindOf("vermelha", 10), "cavaleiro", "lança-estandarte: regra do Cavaleiro + fases");
  const ph = F.BOSSES.varkos;
  assert.deepEqual(ph.map((p) => p.below), [0.66, 0.33]);
  assert.ok(ph[1].rest <= Math.min(...Object.values(F.BOSSES).map((p) => p[1].rest)), "descansa menos que os outros");
  for (const p of ph) for (const a of p.add) if (a.line) assert.equal(a.arc, 0, "todo tiro é reto");
});

test("Floresta Vermelha: saque — materiais, amuleto, Porta-Estandarte no 9 e o fragmento do Varkos no 10", () => {
  for (let s = 1; s <= 10; s++) {
    const t = Items.LOOT_TABLES[`domain:vermelha:${s}`];
    assert.ok(t, `setor ${s}`);
    for (const e of [...t.sure, ...t.chance, ...(t.first || [])]) assert.ok(Items.GEAR_BY_ID.has(e.id), `${s}: ${e.id}`);
  }
  const boss = Items.lootExpectation("domain:vermelha:10", { win: true });
  // weapon-v1: o chefe da Floresta Vermelha paga o Pó SSS III e 3 a 5 fragmentos de classe Divina
  assert.deepEqual(boss.po_ref_sss3, { expected: 1, min: 1, max: 1 });
  assert.deepEqual([boss.frag_classe_divine.min, boss.frag_classe_divine.max], [3, 5]);
  assert.equal(boss.brasa_de_estandarte.min, 1);
  assert.equal(boss.frag_deus_varkos.min, 1);
  assert.equal(Items.lootExpectation("domain:vermelha:10", { win: true, first: true }).frag_deus_varkos.min, 6);
  assert.equal(Items.lootExpectation("domain:vermelha:9", { win: true }).frag_personagem_portaestandarte.min, 1);
  assert.ok(Items.GEAR_BY_ID.get("amuleto_vermelha"));
  assert.equal(Pact.gameOfGod("varkos"), "laminas", "o deus da Arena das Lâminas");
});

test("Floresta Vermelha: robô — o setor 1 quase sempre, o Varkos cerca de metade", () => {
  const W = require("../../scripts/mm-boss-wall");
  const first = W.sectorWinRate("vermelha", 1, 24), last = W.sectorWinRate("vermelha", 10, 24);
  assert.ok(first >= 0.8, `setor 1: ${first}`);
  assert.ok(last <= 0.7 && last >= 0.3, `Varkos: ${last}`);
});
