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

test("E0 — a régua ainda não muda nenhuma regra em uso (teto de hoje intacto)", () => {
  assert.deepStrictEqual({ ...Gear.GEAR_CAP }, { dmg: 0.35, def: 0.25, stam: 0.12, warn: 0.12, power: 0.18 });
  assert.equal(Gear.UPGRADE.MAX, 10);
});

test("E0 — proposta do §7: 71 definições novas, sem id repetido nem colisão com o catálogo de hoje", () => {
  const items = Bal.proposalItems();
  assert.equal(items.length, 71);
  const ids = items.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.ok(!Gear.GEAR_BY_ID.has(id), `colide com o catálogo: ${id}`);
  for (const i of items.filter((x) => x.slot)) {
    assert.equal(i.keys.length, 2, `${i.id}: chaves ${i.keys}`);
    for (const k of i.keys) assert.ok(B.WEIGHT[k][i.slot], `${i.id}: ${k} fora do slot ${i.slot}`);
  }
  const known = new Set(ids);
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

test("I2 — equipamento no teto multiplica a troca pelo mesmo valor (±2%) nos níveis 1…500", { todo: "E4" }, () => {});
test("I3 (catálogo) — todo item real sai da régua: build focado = teto, peça ≤ 50%, fonte ≤ subteto", { todo: "E7" }, () => {});
test("I4 — parcela do equipamento no Poder = o que ele soma à ficha", { todo: "E4" }, () => {});
test("I5 — acuracidade e velocidade entre 1× e 3× a régua nos níveis 10…500", { todo: "E5 (depende da A14)" }, () => {});
test("I6 — a mesma faixa do sorteio da rua dá a mesma distância de régua (±10%) nos níveis 5…200", { todo: "E5 (depende da A15)" }, () => {});
test("I7 — fabricar → desmontar → fabricar perde pelo menos 50% dos materiais", { todo: "E11" }, () => {});
test("I8 — vitórias para +15 nunca abaixo de 270; cruzamento moeda × material nos níveis 6, 17, 31, 53, 80, 114 (±2)", { todo: "E9" }, () => {});
test("I9 — vitórias de chefão para fabricar: 3 a 20 por raridade; pior caso ≤ 1,5 × o esperado", { todo: "E8, E12" }, () => {});
test("I10 — nenhum item de combate existe só em fonte de PvP", { todo: "E17" }, () => {});
