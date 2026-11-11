// Trilha E, fatia E0 — invariantes de equidade do Meu Mundo (plano 2026-11-11, §6.7).
//
// Ligadas na E0: I1 (luta igual não muda com o nível) e a régua pura da I3 (budget.js). As outras ficam
// como `todo` com o nome da fatia que as liga; cada fatia tira o `todo` da sua.
// Contas: scripts/mm-balance.js (as mesmas funções que imprimem o GDD).
const test = require("node:test");
const assert = require("node:assert");
const F = require("../../src/utils/meuMundoFight");
const Gear = require("../../src/utils/meuMundoGear");
const B = require("../../src/utils/mmItems/rules/budget");
const Bal = require("../../scripts/mm-balance");

const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.abs(b);

test("I1 — luta igual: golpes para matar variam no máximo 10% (maior − menor sobre a média) entre os níveis 10…500, em todo tipo de monstro", () => {
  for (const kind of Object.keys(F.MOB_SHEETS)) {
    const sw = Bal.I1_LEVELS.map((L) => Bal.evenFight(kind, L).swings);
    const mean = sw.reduce((a, b) => a + b, 0) / sw.length;
    const spread = (Math.max(...sw) - Math.min(...sw)) / mean;
    assert.ok(spread <= 0.1, `${kind}: ${sw.map((v) => v.toFixed(1)).join(" ")} (variação ${(spread * 100).toFixed(1)}%)`);
    for (const v of sw) assert.ok(Number.isFinite(v) && v > 0, `${kind}: golpes ${v}`);
  }
});

test("I3 (régua) — cada linha de peso por slot soma 1 e só usa os 8 slots", () => {
  for (const k of B.KEYS) {
    const row = B.WEIGHT[k];
    const sum = Object.values(row).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `${k}: soma ${sum}`);
    for (const slot of Object.keys(row)) assert.ok(B.SLOTS.includes(slot), `${k}: slot ${slot}`);
  }
  const share = Object.values(B.SHARE).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(share - 1) < 1e-9, `fatias somam ${share}`);
});

test("I3 (régua) — build focado em cada chave dá o teto ±1%", () => {
  for (const k of B.KEYS) {
    const b = B.focusedBuild(k);
    assert.ok(near(b.total, B.CAP[k], 0.01), `${k}: ${b.total} × teto ${B.CAP[k]}`);
  }
});

test("I3 (régua) — nenhuma peça passa de 50% do teto da chave", () => {
  for (const k of B.KEYS) {
    for (const slot of B.SLOTS) {
      const max = B.piece(k, slot, "mythic", B.PLUS_MAX, B.GRADE_MAX, 1);
      assert.ok(max <= 0.5 * B.CAP[k] + 1e-12, `${k}/${slot}: ${max}`);
    }
  }
});

test("I3 (régua) — nenhuma fonte passa do subteto, nem com plus e grau fora da faixa", () => {
  for (const k of B.KEYS) {
    const b = B.focusedBuild(k);
    for (const [src, v] of Object.entries(b.parts)) assert.ok(v <= B.sourceCap(k, src) + 1e-12, `${k}/${src}: ${v} > ${B.sourceCap(k, src)}`);
    const wild = B.pieceParts(k, "weapon", "mythic", 99, 99, 1);
    const ok = B.pieceParts(k, "weapon", "mythic", B.PLUS_MAX, B.GRADE_MAX, 1);
    assert.deepStrictEqual(wild, ok);
  }
});

test("I3 (régua) — os números do §6.4: dano na arma e chave fora do slot", () => {
  const p = (...a) => Math.round(B.piece(...a) * 10000) / 10000;
  assert.equal(p("dmg", "weapon", "common", 0, 1), 0.0294);
  assert.equal(p("dmg", "weapon", "rare", 0, 1), 0.0588);
  assert.equal(p("dmg", "weapon", "legendary", 10, 1), 0.1189);
  assert.equal(p("dmg", "weapon", "mythic", 15, 5), 0.1715);
  assert.equal(B.piece("def", "weapon", "mythic", 15, 5), 0);
  assert.ok(B.piece("dmg", "weapon", "rare", 0, 1, B.SECONDARY) < B.piece("dmg", "weapon", "rare", 0, 1));
});

test("E4 — teto do equipamento: as 10 chaves do §6.3, iguais no back e na luta (GEAR_MAX)", () => {
  assert.deepStrictEqual({ ...Gear.GEAR_CAP }, { dmg: 0.35, def: 0.25, stam: 0.12, warn: 0.12, power: 0.18, hp: 0.25, acc: 0.2, spd: 0.15, int: 0.15, dex: 0.15 });
  assert.deepStrictEqual({ ...F.GEAR_MAX }, { ...Gear.GEAR_CAP });
  assert.equal(Gear.UPGRADE.MAX, 10);
});

test("E0 — proposta do §7: 71 definições novas, sem id repetido nem colisão com o catálogo de hoje", () => {
  const items = Bal.proposalItems();
  assert.equal(items.length, 71);
  const ids = items.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
  // o que já entrou no catálogo (E7: as 12 peças dos conjuntos) tem de ser a MESMA peça da proposta
  for (const i of items) {
    const c = Gear.GEAR_BY_ID.get(i.id);
    if (c) assert.ok((c.set ?? null) === (i.set ?? null) && (c.slot ?? null) === (i.slot ?? null) && c.rarity === i.rarity && c.category === i.category && String(c.keys || []) === String(i.keys || []), `colide com o catálogo: ${i.id}`);
  }
  for (const i of items.filter((x) => x.slot)) {
    assert.equal(i.keys.length, 2, `${i.id}: chaves ${i.keys}`);
    for (const k of i.keys) assert.ok(B.WEIGHT[k][i.slot], `${i.id}: ${k} fora do slot ${i.slot}`);
  }
  const known = new Set(ids);
  // E8: as 21 receitas por fragmento do catálogo são as da proposta (mesmos ingredientes e custo)
  for (const rc of Bal.proposalRecipes()) {
    const real = Gear.RECIPE_BY_ID.get(rc.id);
    assert.ok(real && real.out === rc.out && real.recipe === rc.recipe && real.coins === rc.coins && JSON.stringify(real.needs) === JSON.stringify(rc.needs), `receita ${rc.id}`);
  }
  for (const rc of Bal.proposalRecipes()) {
    assert.ok(known.has(rc.out) && known.has(rc.recipe), rc.id);
    for (const k of Object.keys(rc.needs)) assert.ok(known.has(k), `${rc.id}: ${k}`);
  }
  for (const [tid, t] of Object.entries(Bal.proposalLoot())) for (const e of [...t.sure, ...t.chance, ...t.first]) assert.ok(known.has(e.id), `${tid}: ${e.id}`);
  assert.equal(Bal.todayGear().length, 106);
});

test("E0 — conjuntos: 4 peças nos setores 7 a 10 entre 25 e 40 vitórias (pior caso do garantido incluído)", () => {
  const loot = Bal.proposalLoot();
  for (const s of Bal.setWins(Bal.proposalRecipes(), loot)) {
    assert.ok(s.wins >= 25 && s.wins <= 40, `${s.set}: ${s.wins}`);
    assert.ok(s.worst <= 40, `${s.set}: pior ${s.worst}`);
  }
});

test("I2 — equipamento no teto multiplica a troca pelo mesmo valor (±2%) nos níveis 1…500", () => {
  const NO = { dmg: 0, def: 0, stam: 0, warn: 0, power: 0 };
  // ataque, defesa e vida no teto: 1,35 × 1,25 × 1,25 = 2,11 (acerto fora: satura em 100%)
  const top = { ...NO, dmg: 0.35, def: 0.25, hp: 0.25 };
  const legend = { ...NO, dmg: 0.33 }; // a lendária +10 de hoje
  for (const L of [1, 5, 10, 20, 30, 60, 100, 200, 500]) {
    const even = (g) => {
      const ms = F.MOB_SHEETS.brute;
      const need = Math.max(0, (F.mobBase(L).rate * ms[4]) / 100 - 100 - 3 * (L - 1));
      return Bal.duel(null, L, { strength: need, speed: need, intelligence: need, dexterity: need }, g, "brute", L).ratio;
    };
    const k = even(top) / even(NO);
    assert.ok(Math.abs(k / 2.109375 - 1) <= 0.02, `nível ${L}: ×${k.toFixed(3)}`);
    const l = even(legend) / even(NO);
    assert.ok(Math.abs(l / 1.33 - 1) <= 0.02, `nível ${L}: lendária ×${l.toFixed(3)}`);
  }
});
test("I3 (catálogo) — todo item real sai da régua: build focado = teto, peça ≤ 50%, fonte ≤ subteto", () => {
  const Items = require("../../src/utils/mmItems");
  const eq = Gear.GEAR.filter((g) => g.slot);
  assert.ok(eq.length >= 118, "106 de hoje + 12 dos conjuntos");
  for (const it of eq) {
    assert.ok(Array.isArray(it.keys) && it.keys.length === 2, it.id + " tem duas chaves");
    for (const k of it.keys) assert.ok(B.WEIGHT[k][it.slot], `${it.id}: ${k} cabe no ${it.slot}`);
    // o bônus do cartão é o da régua (+0 grau I), não escrito à mão
    assert.deepStrictEqual({ ...it.bonus }, Items.pieceBonus(it, 0, 1), it.id);
    // a maior peça do jogo (mítica +15 grau V) não passa de 50% do teto; a real, menos ainda
    for (const k of it.keys) assert.ok(Items.pieceBonus(it, B.PLUS_MAX, B.GRADE_MAX)[k] <= B.CAP[k] * 0.5 + 1e-9, it.id + " ≤ 50%");
  }
  // tudo equipado, tudo no máximo: nenhuma fonte passa do subteto, nenhuma chave passa do teto
  const best = {};
  for (const it of eq) if (!best[it.slot] || it.rarity > best[it.slot].rarity) best[it.slot] = it;
  const r = Items.bonusOf(Object.values(best).map((item) => ({ item, plus: 15, grade: 5 })));
  for (const k of B.KEYS) {
    assert.ok(r.bonus[k] <= B.CAP[k] + 1e-9, k);
    for (const [s, v] of Object.entries(r.sources[k])) assert.ok(Math.min(v, B.sourceCap(k, s)) <= B.sourceCap(k, s) + 1e-9, k + " " + s);
  }
});

test("E7 — conjunto: 1, 2, 3, 4 peças dão 0, 40%, 40%, 100% da fatia nas duas chaves", () => {
  const Items = require("../../src/utils/mmItems");
  const want = { vigilia: { def: 0.025, hp: 0.025 }, forja: { dmg: 0.035, power: 0.018 }, sentinela: { def: 0.025, stam: 0.012 } };
  for (const set of Items.SETS) {
    const pieces = set.pieces.map((id) => ({ item: Gear.GEAR_BY_ID.get(id), plus: 0, grade: 1 }));
    for (let n = 1; n <= 4; n++) {
      const r = Items.bonusOf(pieces.slice(0, n));
      const step = n === 4 ? 1 : n >= 2 ? 0.4 : 0;
      for (const k of set.keys) assert.ok(Math.abs(r.sources[k].set - want[set.id][k] * step) < 1e-9, `${set.id} ${n} peças ${k}`);
    }
  }
});
test("I4 — parcela do equipamento no Poder = o que ele soma à ficha", () => {
  const P = require("../../src/utils/meuMundoPower");
  const NO = {};
  for (const L of [1, 10, 30, 100, 500]) {
    for (const a of [0, 300, 2000]) {
      const attrs = { strength: a, speed: a, intelligence: a, dexterity: a, accuracy: a };
      const g = { ...Gear.GEAR_CAP };
      const with_ = F.heroSheet(null, L, attrs, g), without = F.heroSheet(null, L, attrs, NO);
      const sheet = with_.atk - without.atk + (with_.def - without.def) + (with_.hp - without.hp) + (with_.acc - without.acc) + (with_.spd - without.spd);
      const want = sheet + g.int * a + g.dex * a + 1000 * (g.stam + g.warn + g.power);
      const got = P.powerScore(F, { attrs, level: L, gear: g }).parts.gear;
      assert.ok(Math.abs(got - want) <= 1.5, `L${L} a${a}: ${got} × ${want.toFixed(1)}`);
    }
  }
});
test("I5 — acuracidade e velocidade entre 1× e 3× a régua nos níveis 10…500 (freio da E5, regra em uso)", () => {
  const A = require("../../src/utils/meuMundoAdventure");
  const rows = Bal.sectionD(500);
  for (const r of rows.filter((x) => x.L >= 10)) {
    assert.ok(r.accPX >= 1 && r.accPX <= 3, `nível ${r.L}: acuracidade ×${r.accPX}`);
    assert.ok(r.spdPX >= 1 && r.spdPX <= 3, `nível ${r.L}: velocidade ×${r.spdPX}`);
  }
  // a tabela do §6.3 (A14): 1,45 … 2,24 e 1,09 … 1,92
  const at = (L) => rows.find((x) => x.L === L);
  assert.ok(Math.abs(at(10).accPX - 1.45) <= 0.05 && Math.abs(at(500).accPX - 2.24) <= 0.05);
  assert.ok(Math.abs(at(10).spdPX - 1.09) <= 0.05 && Math.abs(at(500).spdPX - 1.92) <= 0.05);
  // abaixo da régua, drop cheio; nunca zera
  assert.equal(A.dropPace(0, 50), 1);
  assert.ok(A.dropPace(A.ruler(50) * 5, 50) > 0);
});
test("I6 — a mesma faixa do sorteio da rua dá a mesma distância de régua (±10%) nos níveis 5…200", () => {
  const A = require("../../src/utils/meuMundoAdventure");
  for (const [, f] of A.STREET_FACTORS) {
    for (const L of [5, 10, 20, 30, 60, 100, 200]) {
      const k = A.ruler(A.levelForFactor(L, f)) / A.ruler(L);
      assert.ok(k >= f - 1e-9 && k <= f * 1.1, `nível ${L} ×${f}: régua ×${k.toFixed(3)}`);
    }
  }
});
test("I7 — fabricar → desmontar → fabricar perde pelo menos 50% dos materiais", { todo: "E11" }, () => {});
test("I8 — vitórias para +15 nunca abaixo de 270; cruzamento moeda × material nos níveis 6, 17, 31, 53, 80, 114 (±2)", { todo: "E9" }, () => {});
test("I9 (armas) — vitórias de chefão para fabricar: 3 a 20 por raridade; pior caso ≤ 1,5 × o esperado", () => {
  const Items = require("../../src/utils/mmItems");
  const { BOSS_FRAGMENTS, NEED } = Items.LINES;
  const [lo, hi] = BOSS_FRAGMENTS.qty;
  // a primeira vitória já paga os 10 a mais e um sorteio normal
  const wins = (need, per) => { let have = BOSS_FRAGMENTS.first + per, n = 1; while (have < need) { have += per; n++; } return n; };
  const want = { rare: [3, 4], epic: [8, 10], legendary: [13, 17], mythic: [18, 24] };
  for (const [rarity, need] of Object.entries(NEED)) {
    const expected = wins(need, (lo + hi) / 2), worst = wins(need, lo);
    assert.deepEqual([expected, worst], want[rarity], rarity);
    assert.ok(expected >= 3 && expected <= 20, `${rarity}: ${expected} vitórias`);
    assert.ok(worst <= 1.5 * expected, `${rarity}: pior ${worst} > 1,5 × ${expected}`);
  }
  // toda arma de linha pede exatamente o `need` da raridade dela, e o fragmento aponta a arma
  for (const r of Items.RECIPES.filter((x) => x.kind === "fragment" && x.out.startsWith("linha_"))) {
    const out = Items.GEAR_BY_ID.get(r.out);
    const frag = Object.keys(r.needs).map((id) => Items.GEAR_BY_ID.get(id)).find((g) => g.category === "fragment");
    assert.equal(frag.fragment.of, out.id, r.id);
    assert.equal(r.needs[frag.id], NEED[out.rarity], r.id);
    assert.equal(frag.fragment.need, NEED[out.rarity], frag.id);
  }
});
test("I9 (conjuntos) — fragmento dos setores 7 a 10 com a tabela real do Domínio", { todo: "E12" }, () => {});
test("I10 — nenhum item de combate existe só em fonte de PvP", { todo: "E17" }, () => {});
