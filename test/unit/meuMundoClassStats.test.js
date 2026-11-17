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
    // %: de 5 em 5 a partir de 20; a Divina +50 sobre a Lendária
    assert.equal(CS.PERCENT[RANKS[i]] - CS.PERCENT[RANKS[i - 1]], RANKS[i] === "divine" ? 50 : 5, RANKS[i]);
    // preço: 3× até a A, 5× do S para cima
    assert.equal(CS.PRICE[RANKS[i]], CS.PRICE[RANKS[i - 1]] * (i <= 4 ? 3 : 5), RANKS[i]);
  }
  assert.equal(CS.NUMBER.E, 5);
  assert.equal(CS.PERCENT.E, 20);
  assert.equal(CS.PERCENT.divine, 110);
  assert.equal(CS.PRICE.E, 800);
  assert.equal(CS.PRICE.SSR, 8100000);
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

// ── R2: a luta nova (dano = ataque − defesa com piso de 10%, monstro com o kit da classe do nível) ──
const F = require("../../src/utils/meuMundoFight");

test("R2: a escada da luta é a mesma do catálogo (espelho)", () => {
  assert.deepEqual([...F.CLASS_RANKS], [...RANKS]);
  for (const r of RANKS) {
    assert.equal(F.CLASS_NUMBER[r], CS.NUMBER[r], r);
    assert.equal(F.CLASS_PERCENT[r], CS.PERCENT[r], r);
  }
  const rank = require("../../src/utils/mmItems/rules/rank");
  for (let l = 1; l <= 12; l++) assert.equal(F.classByLevel(l), rank.rankByLevel(l), `nível ${l}`);
});

test("filtro de dano: piso de 5% da força no empate (exemplos do Alex)", () => {
  assert.equal(F.strike(200, 100), 105);
  assert.equal(F.strike(100, 100), 5);
  assert.equal(F.strike(100, 300), 5);
  assert.equal(F.strike(100, 0), 100);
  // Domínio: kit uma classe acima; chefão = Lendária
  assert.equal(F.mobKit(5, false, true).flat.atk, Math.round(CS.NUMBER.S * 0.4));
  assert.equal(F.mobKit(5, true).flat.atk, Math.round(CS.NUMBER.legendary * 0.4));
  assert.equal(F.hitChance(100, 200), 0.5);
  assert.equal(F.hitChance(200, 100), 1);
});

test("R2: ticket sem classGear re-simula igual (luta antiga); com classGear usa a regra nova", () => {
  const old = new F.Fight({ kind: "brute", level: 5, hero: 5, tier: "street", seed: 3 });
  assert.equal(old.v2, false);
  const nu = new F.Fight({ kind: "brute", level: 5, hero: 5, tier: "street", seed: 3, classGear: { flat: {}, pct: {} } });
  assert.equal(nu.v2, true);
  // o monstro do nível 5 tem o kit da classe A (arma + escudo)
  const kit = F.mobKit(5);
  assert.equal(kit.flat.atk, Math.round(CS.NUMBER.A * 0.4));
  assert.ok(nu.mobs[0].rate.def > old.mobs[0].rate.def);
});

test("R2: status de quem joga = (ficha + número) × (1 + %)", () => {
  const cls = { flat: { atk: 100, hp: 50 }, pct: { atk: 10 } };
  const a = F.heroSheet(null, 1, { strength: 300, speed: 300, intelligence: 300 }, undefined, undefined, cls);
  assert.ok(Math.abs(a.atk - (100 + 100) * 1.1) < 1e-9);
  assert.equal(a.hp, 150);
});

test("R2: classGearOf soma as peças vestidas", () => {
  const sum = CS.classGearOf([{ stats: { flat: { atk: 2, acc: 2 }, pct: { dmg: 0.05 } } }, { stats: { flat: { atk: 3 }, pct: { dmg: 0.1 } } }, null]);
  assert.deepEqual(sum, { flat: { atk: 5, acc: 2 }, pct: { dmg: 0.15 } });
});

test("preço da loja pela classe e moedas por nível do monstro", () => {
  for (const g of GEAR) if (g.price != null && (g.category === "weapon" || g.category === "shield")) assert.equal(g.price, CS.PRICE[g.rank], g.id);
  const Adv = require("../../src/utils/meuMundoAdventure");
  const mid = () => 0.5;
  assert.equal(Adv.fightCoins("brute", 15, true, mid), 300);
  assert.equal(Adv.fightCoins("wolf", 30, true, mid), 600);
  assert.equal(Adv.fightCoins("wolf", 10, true, mid, true), 600);
});

test("% da classe não cruza: a pior peça de uma classe vale mais que a melhor da anterior", () => {
  for (let i = 1; i < RANKS.length; i++) assert.ok(CS.PERCENT[RANKS[i]] * 0.98 > CS.PERCENT[RANKS[i - 1]] * 1.02, RANKS[i]);
});
