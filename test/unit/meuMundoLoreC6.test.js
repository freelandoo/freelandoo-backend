// test/unit/meuMundoLoreC6.test.js — lore v2 C6 (caps. 9 "A Guarda de Pedra" e 10 "O Peso dos Mortos").
//
// O que é puro: o Cavaleiro Dourado no centro, na calçada do portal dos Bairros, só de
// noite e sem caixa (de dia não sobra parede invisível); a conversa vale do portal ou do
// lugar dele, e o servidor recusa de dia; os passos dos dois capítulos apontam para o que
// existe (cap. 9 = nectar:30, §12 pergunta 2) e o Arquivo dos dois capítulos.
const test = require("node:test");
const assert = require("node:assert/strict");
const Q = require("../../src/utils/meuMundoQuests");
const C = require("../../src/utils/meuMundoCenter");
const P = require("../../src/utils/meuMundoPlaces");
const A = require("../../src/utils/meuMundoArchive");
const PlaceService = require("../../src/services/MeuMundoPlaceService");

const npc = (id) => C.STREET_NPCS.find((n) => n.id === id);
const stepOf = (cap, key) => Q.CHAPTER_BY_ID.get(cap).steps.find((s) => s.key === key);

test("C6: os passos dos caps. 9 e 10 apontam para o que existe", () => {
  assert.equal(stepOf("cap9", "cadeiras").check, "hallChallenge");
  assert.equal(stepOf("cap9", "ouro").check, "fightWin:cavaleiro");
  assert.equal(stepOf("cap9", "aldo").check, "talk:cavaleiro");
  assert.equal(stepOf("cap9", "corrida").check, "nectar:30");
  assert.equal(stepOf("cap10", "lua").check, "game:noturno");
  assert.equal(stepOf("cap10", "ceu").check, "game:corrida");
  assert.equal(stepOf("cap10", "preco").check, "archive:zephyra_almas");
  assert.equal(stepOf("cap10", "sombra").check, "nightKill:wolf");
  assert.equal(stepOf("cap10", "memoria").check, "talk:nivea");
  assert.equal(Q.CHAPTER_BY_ID.get("cap10").next, null, "o cap. 10 fecha a temporada");
  for (const id of ["ordem_sol", "zephyra_almas", "maldicao_pedra"]) assert.ok(A.ENTRY_BY_ID.get(id), id);
  assert.ok(P.NPCS.cavaleiro && P.NPCS.nivea);
  assert.ok(P.SAFE_ID.test("portal_cavaleiro"));
});

test("C6: o Cavaleiro vigia o portal dos Bairros, de noite, sem caixa", () => {
  const k = npc("cavaleiro");
  assert.ok(k, "Cavaleiro fora do centro");
  assert.equal(k.body, "cavaleiro");
  assert.equal(k.hours, "night");
  assert.equal(P.NPCS.cavaleiro.hours, "night");
  assert.equal(P.pickVisit(C.VISIT_POINTS, k.x, k.z), "portal_cavaleiro");
  for (const place of P.NPCS.cavaleiro.places) assert.ok(C.VISIT_POINTS.some((v) => v.id === place), place);
  // noturno no chão: nenhuma caixa no lugar dele (de dia some e não sobra parede)
  assert.ok(!C.OBSTACLES.some((o) => Math.hypot(o.x - k.x, o.z - k.z) < 0.5), "sem caixa");
  // os noturnos em cima do pedestal e os de sempre não mudaram
  assert.ok(C.OBSTACLES.some((o) => Math.abs(o.x - npc("pipa").x) < 0.01 && Math.abs(o.z - npc("pipa").z) < 0.01));
  assert.ok(!C.onRoad(k.x, k.z), "fora da rua");
  assert.ok(C.CENTER_VERSION >= 21);
});

const client = (place, at) => ({ query: async () => ({ rows: place ? [{ place, at }] : [] }) });
// 15:00Z = 12h em Brasília (dia); 01:00Z = 22h (noite)
const DAY = Date.parse("2026-11-11T15:00:00Z");
const NIGHT = Date.parse("2026-11-12T01:00:00Z");

test("C6: a conversa com o Cavaleiro vale do portal ou do lugar dele, só de noite", async () => {
  const near = (now) => new Date(now - 60_000).toISOString();
  assert.equal(await PlaceService.canTalk(client("portal", near(NIGHT)), "u1", "cavaleiro", NIGHT), true);
  assert.equal(await PlaceService.canTalk(client("portal_cavaleiro", near(NIGHT)), "u1", "cavaleiro", NIGHT), true);
  assert.equal(await PlaceService.canTalk(client("praca", near(NIGHT)), "u1", "cavaleiro", NIGHT), false);
  assert.equal(await PlaceService.canTalk(client("portal_cavaleiro", near(DAY)), "u1", "cavaleiro", DAY), false, "de dia ele não está lá");
});
