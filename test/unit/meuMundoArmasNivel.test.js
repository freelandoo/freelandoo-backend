// weapon-v1 (24/11/2026): arma com NÍVEL 1–90 por refino com pó, ESTRELAS por cópia idêntica e forja por
// fragmento de CLASSE. Regra pura em src/utils/mmItems/rules/weaponProgress.js.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Items = require("../../src/utils/mmItems");
const WP = require("../../src/utils/mmItems/rules/weaponProgress");
const Retired = require("../../src/utils/mmItems/catalog/retired");
const B = require("../../src/utils/mmItems/rules/budget");

const sword = Items.GEAR_BY_ID.get("espada_eter");
const armor = Items.GEAR_BY_ID.get("colete_couro");

test("faixas: 1 pó por tentativa, o da faixa do nível de DESTINO; a chance cai e o SSS vem depois do 60", () => {
  assert.equal(WP.POWDERS.length, 9);
  const cases = [[1, "po_ref_d", 1], [9, "po_ref_d", 1], [10, "po_ref_c", 0.95], [11, "po_ref_c", 0.95], [19, "po_ref_c", 0.95], [20, "po_ref_b", 0.9],
    [30, "po_ref_a", 0.8], [40, "po_ref_s", 0.7], [50, "po_ref_ss", 0.6], [59, "po_ref_ss", 0.6], [60, "po_ref_sss1", 0.45], [70, "po_ref_sss2", 0.3], [80, "po_ref_sss3", 0.2], [89, "po_ref_sss3", 0.2]];
  for (const [from, powder, chance] of cases) {
    const c = WP.refineCost(sword, from);
    assert.deepEqual([c.from, c.to, c.powder, c.chance, c.coins], [from, from + 1, powder, chance, 0], `nível ${from}`);
    assert.deepEqual(c.needs, { [powder]: 1 });
  }
  assert.equal(WP.refineCost(sword, 90), null, "teto");
  assert.equal(WP.refineCost(sword, 0), null);
  assert.equal(WP.refineCost(sword, "x"), null);
  assert.equal(WP.refineCost(armor, 1), null, "só arma");
  // a chance nunca sobe com o nível
  let prev = 1;
  for (let lv = 1; lv < 90; lv++) { const ch = WP.refineCost(sword, lv).chance; assert.ok(ch <= prev, `nível ${lv}`); prev = ch; }
  for (let lv = 1; lv < 60; lv++) assert.ok(!WP.refineCost(sword, lv).powder.startsWith("po_ref_sss"), `SSS antes do 60: ${lv}`);
});

test("sorteio: r < chance vence (o número sai no recibo); chance 1 sempre vence", () => {
  assert.ok(WP.rollWins(0.5499, 0.55) && !WP.rollWins(0.55, 0.55) && !WP.rollWins(0.9, 0.55));
  for (const r of [0, 0.5, 0.999999]) assert.ok(WP.rollWins(r, 1));
});

test("estrelas 1→5 garantidas; doadora = mesma arma, outra cópia, nova, sem trava e não vestida", () => {
  assert.deepEqual(WP.starsCost(sword, 1), { rulesVersion: WP.RULES_VERSION, from: 1, to: 2, copies: 1 });
  assert.equal(WP.starsCost(sword, 5), null);
  assert.equal(WP.starsCost(armor, 1), null);
  const base = { id: "a", item: "espada_eter", weaponLevel: 30, grade: 2 };
  const ok = { id: "b", item: "espada_eter", weaponLevel: 1, grade: 1 };
  assert.equal(WP.donorProblem(base, ok), null);
  assert.equal(WP.donorProblem(base, null), "donor");
  assert.equal(WP.donorProblem(base, { ...ok, id: "a" }), "donorself");
  assert.equal(WP.donorProblem(base, { ...ok, item: "espada_latao" }), "donoritem");
  assert.equal(WP.donorProblem(base, { ...ok, locked: true }), "pinned");
  assert.equal(WP.donorProblem(base, { ...ok, equippedBy: 7 }), "worn");
  for (const extra of [{ weaponLevel: 2 }, { grade: 2 }, { sockets: ["runa_forca_1"] }, { ascended: true }, { awakened: true }, { affixes: { enchant: "dmg" } }])
    assert.equal(WP.donorProblem(base, { ...ok, ...extra }), "donorbuilt", JSON.stringify(extra));
});

test("fragmentos de CLASSE: 20 (E) +20 por classe montam QUALQUER arma dela (repetida vale)", () => {
  const weapons = Items.GEAR.filter((g) => WP.isWeapon(g) && !g.retired);
  assert.ok(weapons.length >= 100);
  for (const g of weapons) {
    const c = WP.assemblyCost(g);
    assert.deepEqual(c, { rulesVersion: WP.RULES_VERSION, rank: g.rank, fragment: `frag_classe_${g.rank.toLowerCase()}`, need: WP.FRAGMENT_NEED[g.rank] }, g.id);
    const f = Items.GEAR_BY_ID.get(c.fragment);
    assert.ok(f && f.category === "fragment" && f.stack && f.fragment.rank === g.rank && !f.fragment.of, c.fragment);
  }
  assert.deepEqual(Object.values(WP.FRAGMENT_NEED), [20, 40, 60, 80, 100, 120, 140, 160, 180, 200]);
  assert.equal(WP.FRAGMENT_NEED.E, 20);
  assert.equal(WP.FRAGMENT_NEED.divine, 200);
  assert.equal(WP.assemblyCost(armor), null);
  assert.equal(WP.FRAGMENT_IDS.length, 10);
});

test("régua: o nível vira o plus de antes contra a referência FIXA (90); a conversão nunca rebaixa", () => {
  assert.equal(WP.plusEquiv(1), 0);
  assert.equal(WP.plusEquiv(90), B.PLUS_MAX);
  assert.ok(Math.abs(WP.plusEquiv(45.5) - 7.5) < 1e-9);
  for (let p = 0; p <= 15; p++) {
    const lv = WP.levelFromPlus(p);
    assert.ok(lv >= 1 && lv <= 90);
    assert.ok(WP.plusEquiv(lv) >= p - 1e-9, `+${p} → ${lv}`);
    assert.ok(WP.plusEquiv(lv - 1) < p || lv === 1, `+${p} → ${lv} não sobe além do preciso`);
  }
  assert.deepEqual([0, 4, 10, 15].map(WP.levelFromPlus), [1, 25, 61, 90]);
  // o bônus cresce com o nível e com as estrelas
  const b = (lv, st) => Items.pieceBonus(sword, WP.plusEquiv(lv), st).dmg;
  assert.ok(b(2, 1) > b(1, 1) && b(90, 1) > b(89, 1) && b(30, 3) > b(30, 2));
});

test("economia: gasto esperado de pó do 1 ao 90 por faixa (1 ÷ chance por nível)", () => {
  const e = WP.expectedTotal(90);
  assert.deepEqual(e, { po_ref_d: 9, po_ref_c: 10.5, po_ref_b: 11.1, po_ref_a: 12.5, po_ref_s: 14.3, po_ref_ss: 16.7, po_ref_sss1: 22.2, po_ref_sss2: 33.3, po_ref_sss3: 50 });
  for (const id of WP.POWDER_IDS) assert.ok(Items.sourcesOf(Items.GEAR_BY_ID.get(id)).length > 0, `${id} sem origem`);
});

test("aposentados: pilha vira pó/fragmento novo (nunca zero), Criogenia e preparos ficam", () => {
  const ret = Items.GEAR.filter((g) => Retired.isRetiredStack(g));
  assert.ok(ret.length > 50);
  for (const g of ret) {
    assert.ok(g.retired, g.id);
    const c = Retired.compensation(g, 1);
    assert.ok(c && c.qty >= 1 && Items.GEAR_BY_ID.has(c.id) && !Items.GEAR_BY_ID.get(c.id).retired, g.id);
  }
  assert.deepEqual(Retired.compensation(Items.GEAR_BY_ID.get("pedra_aprimoramento"), 7), { id: "po_ref_d", qty: 7 });
  assert.deepEqual(Retired.compensation(Items.GEAR_BY_ID.get("po_refino"), 25), { id: "po_ref_d", qty: 3 });
  assert.equal(Retired.compensation(Items.GEAR_BY_ID.get("pedra_aprimoramento"), 0), null);
  for (const id of ["embriao_kragor", "ficha_paint", "frag_deus_noctis", "frag_personagem_ciborgue", "po_de_lua", "po_forja"]) assert.ok(!Items.GEAR_BY_ID.get(id).retired, id);
  // equipamento nunca é convertido nem aposentado à força (a cópia continua da pessoa)
  for (const g of Items.GEAR.filter((x) => x.slot)) assert.ok(!Retired.isRetiredStack(g), g.id);
  assert.ok(Items.RECIPES.every((r) => r.kind === "prep" || /^fabricar_(amuleto|embriao)_/.test(r.id)));
});

test("catálogo público leva a regra (versão, faixas, fragmentos)", () => {
  const pub = require("../../src/utils/meuMundoGear").publicGear();
  assert.equal(pub.weaponProgress.rulesVersion, "weapon-v1");
  assert.equal(pub.weaponProgress.maxLevel, 90);
  assert.equal(pub.weaponProgress.maxStars, 5);
  assert.deepEqual(pub.weaponProgress.powders.map((p) => [p.from, p.upTo]), [[2, 10], [11, 20], [21, 30], [31, 40], [41, 50], [51, 60], [61, 70], [71, 80], [81, 90]]);
  assert.equal(pub.weaponProgress.fragments.SSR, "frag_classe_ssr");
});
