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
  assert.equal(D.kindOf("canion", 10), "brute", "Domínio sem fatia própria segue no placeholder");
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
  // régua do B7 (Domínios ainda sem calibração por robô): a soma dos status alcança o Poder recomendado
  for (const id of D.DOMAIN_IDS.filter((x) => !D.LEVELS_BY_DOMAIN[x])) for (let s = 1; s <= 10; s++) assert.ok(D.mobPower(D.kindOf(id, s), D.sectorLevel(id, s)) >= D.recommendedPower(id, s) - 1);
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

// ── D2: a Floresta da Lua pela lore ─────────────────────────────────────────
test("D2: a Floresta pela lore — Mariposas, Cervo, Coruja, Sonâmbulos, Lobos (elite), Selene (guardiã), Noctis (deus)", () => {
  assert.deepEqual(
    Array.from({ length: 10 }, (_, k) => D.foeOf("floresta", k + 1).id),
    ["mariposa", "mariposa", "cervo", "coruja", "sonambulo", "sonambulo", "lobo", "lobo", "selene", "noctis"]
  );
  // a regra é de um tipo que já existe (sem tipo novo, sem RULES_VERSION)
  for (let s = 1; s <= 10; s++) assert.ok(F.MOB_KINDS.includes(D.kindOf("floresta", s)), `setor ${s}`);
  assert.deepEqual([7, 8].map((s) => D.kindOf("floresta", s)), ["wolf", "wolf"], "Lobos de Ferrugem = o elite que já existe");
  // os corpos que desenham são skins do jogo, com ficha na luta
  for (let s = 1; s <= 10; s++) {
    const f = D.foeOf("floresta", s);
    if (f.body) assert.ok(F.BODY_SHEETS[f.body], `setor ${s}: corpo ${f.body}`);
  }
  assert.deepEqual(D.foeOf("floresta", 10), { id: "noctis", body: "noctis", rig: true, art: true });
  assert.equal(D.kindOf("floresta", 10), "ciborgue", "Noctis atira (regra do Alex): arma de fogo do Ciborgue até a D4");
  assert.equal(D.foeOf("floresta", 9).body, "vampira_adulta");
  assert.equal(D.foeOf("floresta", 9).art, false, "Selene de Sombra: arte do Alex pendente");
  assert.equal(D.foeOf("canion", 1), null, "Domínio sem fatia própria: sem criatura da lore");
});

test("D2: níveis da Floresta calibrados com robô (sobem, nunca descem; o deus no topo)", () => {
  const L = Array.from({ length: 10 }, (_, k) => D.sectorLevel("floresta", k + 1));
  assert.deepEqual(L, [...D.LEVELS_BY_DOMAIN.floresta]);
  for (let s = 1; s < 10; s++) assert.ok(L[s] >= L[s - 1], `setor ${s + 1}`);
  assert.ok(L[0] >= 2, "a régua do B7 deixava tudo no nv. 1 (o robô vencia 100%)");
  assert.equal(Math.max(...L), L[9], "o deus é o mais forte");
  assert.equal(D.view(5, {})[0].sectors[9].level, L[9], "a tela mostra o nível calibrado");
});

test("D2: robô — com o Poder recomendado vence quase sempre o setor 1 e menos da metade contra Noctis", () => {
  const C = require("../../scripts/mm-domain-calibrate");
  const at = (s) => C.winRate(D.kindOf("floresta", s), D.sectorLevel("floresta", s), D.recommendedPower("floresta", s), D.heroOf("floresta", s), 24);
  const first = at(1);
  const last = at(10);
  assert.ok(first >= 0.8, `setor 1: ${first}`);
  assert.ok(last <= 0.6, `setor 10: ${last}`);
  assert.ok(first > last);
});

test("D2: Pedraverde é um lugar da cena da Floresta (ao lado do setor 6), mandado pela tela", () => {
  const fl = D.view(5, {})[0];
  assert.deepEqual(fl.places, [{ id: "pedraverde", sector: 6 }]);
  assert.deepEqual(D.view(30, {}, true)[1].places, [], "o Cânion ainda não tem lugar");
  assert.equal(fl.sectors[5].foe.id, "sonambulo");
});
