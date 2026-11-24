// Convocações (gacha-v1, 24/11/2026): regra pura dos três banners de fragmentos.
// Sorteio por `ri(n)` controlado: cada teste escolhe o número que cai, sem amostra estatística.
const test = require("node:test");
const assert = require("node:assert");
const G = require("../../src/utils/mmItems/rules/gacha");
const Items = require("../../src/utils/mmItems");
const Exchange = require("../../src/utils/mmItems/catalog/exchange");
const Loot = require("../../src/utils/mmItems/catalog/loot");

const byId = (id) => Items.GEAR_BY_ID.get(id) || null;
/** ri que devolve os números da fila (e depois `fallback`), conferindo o intervalo. */
const seq = (xs, fallback = 0) => {
  const q = [...xs];
  return (n) => {
    const v = q.length ? q.shift() : fallback;
    assert.ok(Number.isInteger(n) && n > 0, `n inválido ${n}`);
    assert.ok(v >= 0 && v < n, `valor ${v} fora de [0,${n})`);
    return v;
  };
};
const fresh = () => ({ sinceRare: 0, sinceTop: 0, guaranteed: false });

test("a regra se valida: pesos somam 1000, ids existem e são fragmentos, cápsulas e Faísca existem", () => {
  assert.deepStrictEqual(G.validate(byId), []);
  assert.strictEqual(byId("faisca_eter").category, "currency");
  assert.strictEqual(byId("faisca_eter").sell, 0);
});

test("só os 12 jogáveis: guardiões que não são espécie ficam fora", () => {
  const ids = G.CHARACTERS.map((c) => c.id).sort();
  assert.deepStrictEqual(ids, ["aeryn", "brutamontes", "cavaleiro", "ciborgue", "garras", "golem", "iris", "kragor", "maru", "noctis", "varkos", "zephyra"]);
  for (const out of ["selene", "carta", "ondina", "esteira", "arco", "portaestandarte"]) assert.ok(!G.CHARACTER_BY_ID.has(out));
});

test("quantidade = 1/10 da peça", () => {
  assert.strictEqual(G.WEAPON_QTY.E, 2);
  assert.strictEqual(G.WEAPON_QTY.divine, 20);
  assert.strictEqual(G.PROTECTION_QTY.A, 7);
  assert.strictEqual(G.PROTECTION_QTY.SSR, 15);
});

test("ponderado: fronteiras exatas dos intervalos (E=[0,220), D=[220,420) … Divina=[995,1000))", () => {
  const roll = (x) => G.rollOne("weapons", null, fresh(), seq([x])).result.rank;
  assert.strictEqual(roll(0), "E");
  assert.strictEqual(roll(219), "E");
  assert.strictEqual(roll(220), "D");
  assert.strictEqual(roll(989), "legendary");
  assert.strictEqual(roll(994), "legendary");
  assert.strictEqual(roll(995), "divine");
  assert.strictEqual(roll(999), "divine");
});

test("Armas: o prêmio é o fragmento de classe com a quantidade da classe", () => {
  const r = G.rollOne("weapons", null, fresh(), seq([995])).result;
  assert.deepStrictEqual({ item: r.item, qty: r.qty, tier: r.tier }, { item: "frag_classe_divine", qty: 20, tier: "top" });
});

test("Raro garantido: 9 comuns seguidos → o 10º sorteia só entre A…Divina", () => {
  const { results, state } = G.rollMany("weapons", null, fresh(), 10, seq(Array(9).fill(0).concat([0])));
  assert.ok(results.slice(0, 9).every((r) => r.tier === "common" && r.pity === null));
  assert.strictEqual(results[9].rank, "A"); // ri(270)=0 → primeira classe Raro+
  assert.strictEqual(results[9].pity, "rare");
  assert.strictEqual(state.sinceRare, 0);
  assert.strictEqual(state.sinceTop, 10);
});

test("Raro garantido zera ao sair Raro antes do 10º", () => {
  const { state } = G.rollMany("weapons", null, fresh(), 5, seq([0, 0, 900, 0, 0]));
  assert.strictEqual(state.sinceRare, 2);
});

test("Topo garantido no 40º: 39 sem Topo → o 40º é Lendária/Divina", () => {
  const st = { sinceRare: 0, sinceTop: 38, guaranteed: false };
  const before = G.rollOne("weapons", null, st, seq([0]));
  assert.strictEqual(before.result.tier, "common"); // 39º ainda não força
  const at = G.rollOne("weapons", null, before.state, seq([0]));
  assert.strictEqual(at.result.pity, "top");
  assert.strictEqual(at.result.rank, "legendary"); // ri(20)=0 → Lendária (15 de 20)
  const atDiv = G.rollOne("weapons", null, before.state, seq([15]));
  assert.strictEqual(atDiv.result.rank, "divine");
  assert.deepStrictEqual({ r: at.state.sinceRare, t: at.state.sinceTop }, { r: 0, t: 0 });
});

test("lote de 10 aplica a garantia giro a giro, em ordem", () => {
  const st = { sinceRare: 3, sinceTop: 35, guaranteed: false };
  const { results } = G.rollMany("weapons", null, st, 10, seq([], 0));
  // sinceTop 35 → o 5º giro do lote é o 40º
  assert.strictEqual(results[4].pity, "top");
  // sinceRare 3 → o 7º giro do lote é o 10º sem Raro… mas o Topo do 5º zerou: próximo Raro forçado no 15º
  assert.ok(results.slice(5).every((r) => r.pity === null));
});

test("Proteções: com alvo, a classe do alvo cai sempre no alvo; outra classe sorteia entre as peças dela", () => {
  const tgt = G.PROTECTION_POOL.legendary[3].replace(/^frag_/, "");
  const hit = G.rollOne("protections", tgt, fresh(), seq([990])).result;
  assert.strictEqual(hit.item, `frag_${tgt}`);
  assert.strictEqual(hit.featured, true);
  const other = G.rollOne("protections", tgt, fresh(), seq([0, 1])).result;
  assert.strictEqual(other.rank, "E");
  assert.strictEqual(other.item, G.PROTECTION_POOL.E[1]);
});

test("Personagens 50/50: ganhou → alvo sem marca; perdeu → outro e a marca garante o próximo", () => {
  const top = { sinceRare: 0, sinceTop: 39, guaranteed: false };
  const win = G.rollOne("characters", "noctis", top, seq([0]));
  assert.deepStrictEqual([win.result.character, win.result.featured, win.state.guaranteed, win.result.qty], ["noctis", true, false, 20]);
  const lose = G.rollOne("characters", "noctis", top, seq([1, 0]));
  assert.notStrictEqual(lose.result.character, "noctis");
  assert.strictEqual(lose.result.featured, false);
  assert.strictEqual(lose.state.guaranteed, true);
  const next = G.rollOne("characters", "noctis", { ...lose.state, sinceTop: 39 }, seq([]));
  assert.deepStrictEqual([next.result.character, next.result.featured, next.state.guaranteed], ["noctis", true, false]);
});

test("Personagens: faixas comum/raro dão especial, épico dá deus", () => {
  const c = G.rollOne("characters", "noctis", fresh(), seq([0, 0])).result;
  assert.deepStrictEqual([c.tier, c.qty, G.SPECIALS.some((s) => s.frag === c.item)], ["common", 1, true]);
  const e = G.rollOne("characters", "noctis", fresh(), seq([960, 0])).result;
  assert.deepStrictEqual([e.tier, e.qty, G.GODS.some((s) => s.frag === e.item)], ["epic", 5, true]);
});

test("alvo: obrigatório nos Personagens, opcional nas Proteções, proibido nas Armas", () => {
  assert.strictEqual(G.normalizeTarget("characters", null), undefined);
  assert.strictEqual(G.normalizeTarget("characters", "selene"), undefined);
  assert.strictEqual(G.normalizeTarget("characters", "golem"), "golem");
  assert.strictEqual(G.normalizeTarget("protections", ""), null);
  assert.strictEqual(G.normalizeTarget("protections", "nao_existe"), undefined);
  assert.strictEqual(G.normalizeTarget("weapons", "x"), undefined);
  assert.strictEqual(G.normalizeTarget("weapons", null), null);
});

test("o que se publica: chances base somam 100% e o Topo consolidado sai da garantia do 40º", () => {
  const pub = G.publicRules();
  for (const b of pub.banners) assert.strictEqual(Math.round(b.rates.reduce((s, r) => s + r.base, 0) * 1000) / 1000, 100);
  const w = pub.banners.find((b) => b.id === "weapons");
  assert.ok(w.topConsolidated > 3.5 && w.topConsolidated < 3.7, String(w.topConsolidated));
  assert.deepStrictEqual(pub.pity, { rare: 10, top: 40 });
});

test("Faísca: Domínios 7–10 e Loja de troca pagam; ninguém vende por Gold/Esmeralda", () => {
  const boss = Loot.TABLES["domain:floresta:10"];
  assert.ok(boss.sure.some((l) => l.id === "faisca_eter" && l.qty[0] === 2));
  assert.ok(boss.first.some((l) => l.id === "faisca_eter" && l.qty[0] === 20));
  assert.ok(Loot.TABLES["domain:gelo:8"].chance.some((l) => l.id === "faisca_eter" && l.p === 0.3));
  assert.ok(!Loot.TABLES["domain:gelo:6"].chance.some((l) => l.id === "faisca_eter"));
  const offers = Exchange.OFFERS.filter((o) => o.gives.faisca_eter);
  assert.ok(offers.length >= 6);
  assert.ok(offers.every((o) => o.token.startsWith("ficha_")));
});
