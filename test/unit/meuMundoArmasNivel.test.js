// weapon-v2 (24/11/2026): arma com NÍVEL 1–90 por BARRA DE XP (pó da classe, sorteio que pode tirar XP,
// aceitar/recusar), ESTRELAS por cópia idêntica e forja por fragmento de CLASSE. Regra pura em src/utils/mmItems/rules/weaponProgress.js.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Items = require("../../src/utils/mmItems");
const WP = require("../../src/utils/mmItems/rules/weaponProgress");
const Retired = require("../../src/utils/mmItems/catalog/retired");
const B = require("../../src/utils/mmItems/rules/budget");

const sword = Items.GEAR_BY_ID.get("espada_eter");
const armor = Items.GEAR_BY_ID.get("colete_couro");

test("pó da CLASSE: 10 pós, um por classe; pó B só refina arma B", () => {
  assert.equal(WP.POWDERS.length, 10);
  assert.deepEqual(WP.POWDER_IDS, ["po_ref_e", "po_ref_d", "po_ref_c", "po_ref_b", "po_ref_a", "po_ref_s", "po_ref_ss", "po_ref_ssr", "po_ref_legendary", "po_ref_divine"]);
  const weapons = Items.GEAR.filter((g) => WP.isWeapon(g) && !g.retired);
  for (const g of weapons) {
    const c = WP.refineCost(g, 1);
    assert.equal(c.powder, `po_ref_${g.rank.toLowerCase()}`, g.id);
    assert.deepEqual(c.needs, { [c.powder]: 1 });
    assert.equal(WP.refineCost(g, 60, 5).powder, c.powder, "o nível não muda o pó");
  }
  const c = WP.refineCost(sword, 37, 12);
  assert.deepEqual([c.level, c.xp, c.need, c.coins], [37, 12, WP.xpNeed(37), 0]);
  assert.equal(WP.refineCost(sword, 90), null, "teto");
  assert.equal(WP.refineCost(sword, 0), null);
  assert.equal(WP.refineCost(sword, "x"), null);
  assert.equal(WP.refineCost(armor, 1), null, "só arma");
});

test("barra: 100 XP no nível 1 e dobra a cada 5 níveis; no 90 não há barra", () => {
  assert.equal(WP.xpNeed(1), 100);
  assert.equal(WP.xpNeed(6), 200);
  assert.equal(WP.xpNeed(11), 400);
  assert.equal(WP.xpNeed(46), 51200);
  for (let lv = 1; lv < 89; lv++) assert.ok(WP.xpNeed(lv + 1) > WP.xpNeed(lv), `nível ${lv}`);
  for (let lv = 1; lv + 5 < 90; lv++) assert.ok(Math.abs(WP.xpNeed(lv + 5) / WP.xpNeed(lv) - 2) < 0.02, `dobra: ${lv}`);
  assert.equal(WP.xpNeed(90), null);
  assert.equal(WP.xpNeed(0), null);
});

test("sorteio: 4 faixas que somam 100%; pode tirar XP; os extremos caem nas pontas", () => {
  assert.ok(Math.abs(WP.TIERS.reduce((a, t) => a + t.p, 0) - 1) < 1e-9);
  assert.deepEqual(WP.rollXp(0, 0), { tier: "loss", xp: -40 });
  assert.deepEqual(WP.rollXp(0.1499, 0.999999), { tier: "loss", xp: -10 });
  assert.deepEqual(WP.rollXp(0.15, 0), { tier: "normal", xp: 20 });
  assert.deepEqual(WP.rollXp(0.7499, 0.999999), { tier: "normal", xp: 60 });
  assert.deepEqual(WP.rollXp(0.75, 0.5), { tier: "good", xp: 90 });
  assert.deepEqual(WP.rollXp(0.95, 0), { tier: "great", xp: 150 });
  assert.deepEqual(WP.rollXp(0.999999, 0.999999), { tier: "great", xp: 250 });
  // média: ~48 aceitando tudo; ~52 aceitando só o que sobe (o "10 vezes")
  const e = WP.expectedXp();
  assert.ok(Math.abs(e.all - 48.25) < 1e-9 && Math.abs(e.up - 52) < 1e-9, JSON.stringify(e));
});

test("aplicar XP: sobra passa de nível (vários de uma vez), perda para no começo da barra, teto zera", () => {
  assert.deepEqual(WP.applyXp(1, 90, 50), { level: 2, xp: 40, up: 1 });
  assert.deepEqual(WP.applyXp(1, 0, 250), { level: 3, xp: 250 - 100 - WP.xpNeed(2), up: 2 });
  assert.deepEqual(WP.applyXp(5, 30, -40), { level: 5, xp: 0, up: 0 }, "nunca desce de nível");
  assert.deepEqual(WP.applyXp(5, 30, -10), { level: 5, xp: 20, up: 0 });
  assert.deepEqual(WP.applyXp(89, WP.xpNeed(89) - 1, 250), { level: 90, xp: 0, up: 1 });
  assert.deepEqual(WP.applyXp(90, 0, 250), { level: 90, xp: 0, up: 0 });
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
  for (const extra of [{ weaponLevel: 2 }, { weaponXp: 5 }, { weaponPending: { xp: 30 } }, { grade: 2 }, { sockets: ["runa_forca_1"] }, { ascended: true }, { awakened: true }, { affixes: { enchant: "dmg" } }])
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

test("economia: a curva dobra a cada 5 níveis — o 30 é alcançável, o 90 é para o acelerador dos últimos Domínios", () => {
  assert.equal(WP.expectedPowders(1, 2), 2);
  assert.ok(WP.expectedPowders(1, 30) < 1000, String(WP.expectedPowders(1, 30)));
  assert.ok(WP.expectedPowders(1, 90) > 2_500_000, String(WP.expectedPowders(1, 90)));
  for (const id of WP.POWDER_IDS) assert.ok(Items.sourcesOf(Items.GEAR_BY_ID.get(id)).length > 0, `${id} sem origem`);
  // os pós da weapon-v1 saíram: sem origem, viram o pó da classe 1:1
  for (const [from, to] of Object.entries(WP.LEGACY_POWDERS)) {
    const g = Items.GEAR_BY_ID.get(from);
    assert.ok(g && g.retired && Retired.isRetiredStack(g), from);
    assert.deepEqual(Retired.compensation(g, 7), { id: to, qty: 7 });
  }
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

test("catálogo público leva a regra (versão, pó por classe, barra, sorteio, fragmentos)", () => {
  const pub = require("../../src/utils/meuMundoGear").publicGear();
  assert.equal(pub.weaponProgress.rulesVersion, "weapon-v2");
  assert.equal(pub.weaponProgress.maxLevel, 90);
  assert.equal(pub.weaponProgress.maxStars, 5);
  assert.equal(pub.weaponProgress.batch, 10);
  assert.deepEqual(pub.weaponProgress.powders.map((p) => p.rank), ["E", "D", "C", "B", "A", "S", "SS", "SSR", "legendary", "divine"]);
  assert.equal(pub.weaponProgress.xpNeed.length, 89);
  assert.equal(pub.weaponProgress.xpNeed[0], 100);
  assert.equal(pub.weaponProgress.tiers.length, 4);
  assert.equal(pub.weaponProgress.fragments.SSR, "frag_classe_ssr");
});
