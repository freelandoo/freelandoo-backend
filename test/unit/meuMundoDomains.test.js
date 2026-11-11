// test/unit/meuMundoDomains.test.js — lore v2 D1: a regra dos Domínios (travessia,
// travas por nível do treinador, setores em ordem, monstro e nível pelo setor) e o
// portal na praça.
const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../../src/utils/meuMundoDomains");
const C = require("../../src/utils/meuMundoCenter");
const F = require("../../src/utils/meuMundoFight");
const { resolveCircle } = require("../../src/utils/meuMundoMotion");

test("os seis Domínios na ordem da travessia, com o nível do treinador da tabela", () => {
  assert.deepEqual(D.DOMAIN_IDS, ["floresta", "canion", "gelo", "fabrica", "vulcao", "orbital"]);
  assert.deepEqual(D.DOMAINS.map((d) => d.need), [5, 9, 13, 17, 21, 25]);
  assert.deepEqual(D.DOMAINS.map((d) => d.god), ["noctis", "zephyra", "maru", "aeryn", "kragor", "iris"]);
  assert.equal(D.SECTORS, 10);
});

test("trava: nível do treinador no primeiro Domínio", () => {
  assert.deepEqual(D.lockOf("floresta", 4, {}), { code: "trainer", level: 5 });
  assert.equal(D.lockOf("floresta", 5, {}), null);
  assert.equal(D.lockOf("floresta", 1, {}, true), null, "admin passa direto");
});

test("trava: travessia — o próximo só abre com o setor 10 do anterior vencido", () => {
  assert.deepEqual(D.lockOf("canion", 30, { floresta: 9 }), { code: "crossing", from: "floresta" });
  assert.equal(D.lockOf("canion", 30, { floresta: 10 }), null);
  // atravessou mas não tem o nível: a travessia não basta
  assert.deepEqual(D.lockOf("canion", 8, { floresta: 10 }), { code: "trainer", level: 9 });
  // pular um Domínio não vale, mesmo com nível
  assert.deepEqual(D.lockOf("gelo", 30, { floresta: 10 }), { code: "crossing", from: "canion" });
  assert.equal(D.lockOf("gelo", 30, { floresta: 10, canion: 10 }), null);
  assert.deepEqual(D.lockOf("orbital", 30, { floresta: 10, canion: 10, gelo: 10, fabrica: 10, vulcao: 3 }), { code: "crossing", from: "vulcao" });
  assert.equal(D.lockOf("orbital", 1, {}, true), null, "admin passa direto");
  assert.deepEqual(D.lockOf("nada", 30, {}), { code: "domain" });
});

test("setores em ordem: o 1 abre com o Domínio, o N depois do N−1; vencidos ficam livres", () => {
  assert.equal(D.sectorOpen("floresta", 1, 5, {}), true);
  assert.equal(D.sectorOpen("floresta", 2, 5, {}), false);
  assert.equal(D.sectorOpen("floresta", 4, 5, { floresta: 3 }), true);
  assert.equal(D.sectorOpen("floresta", 5, 5, { floresta: 3 }), false);
  assert.equal(D.sectorOpen("floresta", 2, 5, { floresta: 3 }), true, "setor vencido segue aberto para farmar");
  assert.equal(D.sectorOpen("floresta", 1, 4, {}), false, "Domínio fechado fecha os setores");
  assert.equal(D.sectorOpen("floresta", 11, 5, { floresta: 10 }), false);
  assert.equal(D.sectorOpen("floresta", 0, 5, {}), false);
  assert.equal(D.sectorOpen("floresta", 7, 1, {}, true), true, "admin passa direto");
});

test("monstro e nível pelo setor: comuns, fortes, elite (Lobos na Floresta), guardião e o deus; nível nunca desce", () => {
  assert.deepEqual(D.DOMAIN_IDS.map((id) => D.kindOf(id, 7)), Array(6).fill("wolf"));
  assert.equal(D.kindOf("floresta", 1), "cavaleiro");
  assert.equal(D.kindOf("floresta", 10), "brute");
  for (const id of D.DOMAIN_IDS) for (let s = 1; s <= 10; s++) assert.ok(F.MOB_KINDS.includes(D.kindOf(id, s)), `${id} ${s}`);
  let prev = 0;
  for (const id of D.DOMAIN_IDS) {
    for (let s = 1; s <= 10; s++) {
      const L = D.sectorLevel(id, s);
      assert.ok(Number.isInteger(L) && L >= 1, `${id} ${s}`);
      assert.ok(L >= prev || s === 1, `${id} ${s}: o nível não desce dentro do Domínio`);
      prev = L;
    }
  }
  // a travessia sobe a dificuldade: o deus do último é mais forte que o do primeiro
  assert.ok(D.sectorLevel("orbital", 10) > D.sectorLevel("floresta", 10));
  // régua do B7: a soma dos status alcança o Poder recomendado
  for (const id of D.DOMAIN_IDS) for (let s = 1; s <= 10; s++) assert.ok(D.mobPower(D.kindOf(id, s), D.sectorLevel(id, s)) >= D.recommendedPower(id, s) - 1);
});

test("Poder recomendado sobe por setor e por Domínio (lore: 150 → 600 na Floresta, 2.200 → 3.000 na Orbital)", () => {
  assert.equal(D.recommendedPower("floresta", 1), 150);
  assert.equal(D.recommendedPower("floresta", 10), 600);
  assert.equal(D.recommendedPower("orbital", 1), 2200);
  assert.equal(D.recommendedPower("orbital", 10), 3000);
  assert.equal(D.recommendedPower("floresta", 11), null);
});

test("três palcos de luta por Domínio: entrada, setores fundos, palácio", () => {
  assert.deepEqual([1, 4, 5, 8, 9, 10].map(D.stageOf), ["entrada", "entrada", "fundo", "fundo", "palacio", "palacio"]);
});

test("a tela: aberto/fechado, setores vencidos e a passagem depois do setor 10", () => {
  const v = D.view(9, { floresta: 10, canion: 2 });
  const fl = v.find((d) => d.id === "floresta");
  const ca = v.find((d) => d.id === "canion");
  const ge = v.find((d) => d.id === "gelo");
  assert.equal(fl.open, true);
  assert.equal(fl.crossed, true);
  assert.deepEqual(fl.passage, { to: "canion", open: true });
  assert.equal(ca.open, true);
  assert.equal(ca.passage, null);
  assert.deepEqual(ca.sectors.map((s) => s.open), [true, true, true, false, false, false, false, false, false, false]);
  assert.deepEqual(ca.sectors.map((s) => s.cleared).filter(Boolean).length, 2);
  assert.equal(ge.open, false);
  assert.deepEqual(ge.lock, { code: "crossing", from: "canion" });
  // a passagem existe mas o próximo pede nível
  assert.deepEqual(D.view(8, { floresta: 10 })[0].passage, { to: "canion", open: false });
  assert.equal(D.view(30, {}).at(-1).passage, null, "o último não tem passagem");
});

test("portal dos Domínios na praça: fora do miolo e da estátua, pilares com colisão e vão livre", () => {
  const P = C.DOMAIN_PORTAL;
  assert.ok(P && P.id === "portal-dominios");
  assert.ok(Math.hypot(P.x, P.z) - P.radius > 7.5, "fora do alcance da estátua de Morkhan");
  assert.ok(Math.abs(P.x) - 0.45 > 11.5, "o miolo da praça fica livre");
  const pillars = C.OBSTACLES.filter((b) => b.x === P.x && Math.abs(Math.abs(b.z - P.z) - P.span) < 1e-6);
  assert.equal(pillars.length, 2);
  // o vão debaixo do arco é andável
  assert.ok(C.isSafeSpot(P.x, P.z, resolveCircle, 0.35));
  const pay = C.buildCenterPayload();
  assert.deepEqual(pay.domainPortal, P);
  assert.ok(C.VISIT_POINTS.some((v) => v.id === "portal_dominios"));
  assert.ok(C.CENTER_VERSION >= 19);
});
