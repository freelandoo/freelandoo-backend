// test/unit/meuMundoLoreC5.test.js — lore v2 C5 (cap. 8 "Pedraverde").
//
// O que é puro: Pipa na frente do Boxe (NPC com colisão, ponto de visita próprio,
// conversa vale da porta ou do lugar dela), Pedraverde e o ponto do Golem como lugares
// da cena do Domínio (abrem junto com o setor 6), e os passos do capítulo com o que existe.
const test = require("node:test");
const assert = require("node:assert/strict");
const Q = require("../../src/utils/meuMundoQuests");
const C = require("../../src/utils/meuMundoCenter");
const P = require("../../src/utils/meuMundoPlaces");
const D = require("../../src/utils/meuMundoDomains");
const A = require("../../src/utils/meuMundoArchive");
const PlaceService = require("../../src/services/MeuMundoPlaceService");

const npc = (id) => C.STREET_NPCS.find((n) => n.id === id);
const cap8 = Q.CHAPTER_BY_ID.get("cap8");
const stepOf = (key) => cap8.steps.find((s) => s.key === key);

test("C5: os passos do cap. 8 apontam para o que existe", () => {
  assert.equal(stepOf("clareira").check, "visit:pedraverde");
  assert.equal(stepOf("peito").check, "visit:golem");
  assert.equal(stepOf("pipa").check, "talk:pipa");
  assert.equal(stepOf("campeao").check, "fightWin:brute");
  assert.equal(stepOf("muralha").check, "fightWin:stone");
  assert.ok(P.NPCS.pipa, "Pipa sem lugar");
  assert.ok(npc("pipa"), "Pipa fora do centro");
  const pv = D.placeOf("floresta", "pedraverde");
  assert.ok(pv && pv.spots.includes("golem"));
  // os ids são seguros para a gravação de visita
  for (const id of ["pedraverde", "golem", "boxe_pipa"]) assert.ok(P.SAFE_ID.test(id), id);
  assert.ok(A.ENTRY_BY_ID.get("pedraverde") && A.ENTRY_BY_ID.get("brutamontes"));
});

test("C5: Pipa fica na frente do Boxe, no ponto dela, sem tapar a porta", () => {
  const p = npc("pipa");
  assert.equal(p.body, "raposa_adulta");
  assert.equal(p.hours, undefined); // sempre lá
  assert.equal(p.y, undefined); // no chão: tem caixa
  assert.equal(P.pickVisit(C.VISIT_POINTS, p.x, p.z), "boxe_pipa");
  for (const place of P.NPCS.pipa.places) assert.ok(C.VISIT_POINTS.some((v) => v.id === place), place);
  assert.ok(C.OBSTACLES.some((o) => Math.abs(o.x - p.x) < 0.01 && Math.abs(o.z - p.z) < 0.01));
  const boxe = C.PLACES.find((b) => b.id === "boxe");
  assert.ok(Math.hypot(p.x - boxe.interact.x, p.z - boxe.interact.z) > 4, "longe da porta");
  assert.ok(!C.onRoad(p.x, p.z), "fora da rua");
  assert.ok(p.x > boxe.rect.x1 + 1 && Math.abs(p.z) < C.LIMIT - 1, "fora do prédio, dentro da cerca");
});

// cliente falso: a última visita da pessoa
const client = (place, at) => ({ query: async () => ({ rows: place ? [{ place, at }] : [] }) });
const NOW = Date.parse("2026-11-11T15:00:00Z");

test("C5: a conversa com a Pipa vale da porta do Boxe ou do lugar dela", async () => {
  const at = new Date(NOW - 60_000).toISOString();
  assert.equal(await PlaceService.canTalk(client("boxe", at), "u1", "pipa", NOW), true);
  assert.equal(await PlaceService.canTalk(client("boxe_pipa", at), "u1", "pipa", NOW), true);
  assert.equal(await PlaceService.canTalk(client("laminas", at), "u1", "pipa", NOW), false);
});

test("C5: Pedraverde abre junto com o setor 6 (o 5 vencido); admin passa", () => {
  assert.equal(D.placeOpen("floresta", "pedraverde", {}, false), false);
  assert.equal(D.placeOpen("floresta", "pedraverde", { floresta: 4 }, false), false);
  assert.equal(D.placeOpen("floresta", "pedraverde", { floresta: 5 }, false), true);
  assert.equal(D.placeOpen("floresta", "pedraverde", { floresta: 10 }, false), true);
  assert.equal(D.placeOpen("floresta", "pedraverde", {}, true), true);
  assert.equal(D.placeOpen("floresta", "ninho", { floresta: 10 }, true), false);
  assert.equal(D.placeOpen("canion", "pedraverde", { canion: 10 }, true), false);
  // a tela manda o ponto do Golem
  const fl = D.view(5, { floresta: 5 }, false).find((d) => d.id === "floresta");
  assert.deepEqual(fl.places, [{ id: "pedraverde", sector: 6, spots: ["golem"] }]);
});
