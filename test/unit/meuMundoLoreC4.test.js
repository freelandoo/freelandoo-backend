// test/unit/meuMundoLoreC4.test.js — lore v2 C4 (caps. 6 "A Ponte da Maré" e 7 "A Boca Costurada").
//
// O que é puro: o Ciborgue no fundo da Arena das Lâminas (NPC com colisão, ponto de
// visita próprio, conversa vale da porta ou do canto dele), Fulvo no pedestal de
// Morkhan só de noite (07-falas §12, pergunta 3), a conversa com Fulvo recusada de dia
// pelo SERVIDOR e os passos dos dois capítulos com os NPCs que existem.
const test = require("node:test");
const assert = require("node:assert/strict");
const Q = require("../../src/utils/meuMundoQuests");
const C = require("../../src/utils/meuMundoCenter");
const P = require("../../src/utils/meuMundoPlaces");
const A = require("../../src/utils/meuMundoArchive");
const PlaceService = require("../../src/services/MeuMundoPlaceService");

const npc = (id) => C.STREET_NPCS.find((n) => n.id === id);

test("C4: os passos 'porta_azul' e 'fulvo' falam com NPCs que existem no centro", () => {
  const cap6 = Q.CHAPTER_BY_ID.get("cap6");
  for (const key of ["porta_azul", "fulvo"]) {
    const { type, arg } = Q.parseCheck(cap6.steps.find((s) => s.key === key).check);
    assert.equal(type, "talk");
    assert.ok(P.NPCS[arg], `NPC ${arg} sem lugar`);
    assert.ok(npc(arg), `NPC ${arg} fora do centro`);
  }
  // Fulvo fica na praça (não no bairro do outro povo)
  assert.equal(cap6.steps.find((s) => s.key === "fulvo").where, "praca");
  const cap7 = Q.CHAPTER_BY_ID.get("cap7");
  assert.equal(cap7.steps.find((s) => s.key === "telhados").check, "fightWin:garras");
  assert.equal(cap7.steps.find((s) => s.key === "caderno").check, "archive:caderno_aeryn");
  assert.ok(A.ENTRY_BY_ID.get("caderno_aeryn"));
});

test("C4: o Ciborgue treina no fundo da Arena, no ponto dele, sem tapar a porta", () => {
  const c = npc("ciborgue");
  assert.equal(c.body, "ciborgue");
  assert.equal(c.hours, undefined); // sempre lá
  assert.equal(c.y, undefined); // no chão: tem caixa
  assert.equal(P.pickVisit(C.VISIT_POINTS, c.x, c.z), "laminas_fundo");
  for (const place of P.NPCS.ciborgue.places) assert.ok(C.VISIT_POINTS.some((p) => p.id === place), place);
  // a caixa dele está na lista de obstáculos e longe da porta da Arena
  assert.ok(C.OBSTACLES.some((o) => Math.abs(o.x - c.x) < 0.01 && Math.abs(o.z - c.z) < 0.01));
  const lam = C.PLACES.find((p) => p.id === "laminas");
  assert.ok(Math.hypot(c.x - lam.entry.x, c.z - lam.entry.z) > 4);
  // fora do prédio e dentro da cerca
  assert.ok(c.x > lam.rect.x1 + 1 && Math.abs(c.z) < C.LIMIT - 1);
});

test("C4: Fulvo fica no pedestal de Morkhan, do outro lado do Arauto, só de noite, sem caixa", () => {
  const f = npc("fulvo");
  const a = npc("arauto");
  assert.equal(f.hours, "night");
  assert.equal(f.y, C.MONUMENT.h);
  assert.equal(f.x, a.x);
  assert.equal(f.z, -a.z);
  assert.ok(Math.hypot(f.x, f.z) < C.MONUMENT.radius);
  assert.ok(!C.OBSTACLES.some((o) => Math.abs(o.x - f.x) < 0.01 && Math.abs(o.z - f.z) < 0.01));
  assert.equal(P.NPCS.fulvo.hours, "night");
});

// cliente falso: a última visita da pessoa
const client = (place, at) => ({ query: async () => ({ rows: place ? [{ place, at }] : [] }) });
// 2026-11-11 23:00 UTC = 20h em Brasília (noite); 15:00 UTC = 12h (dia)
const NIGHT = Date.parse("2026-11-11T23:00:00Z");
const DAY = Date.parse("2026-11-11T15:00:00Z");

test("C4: o servidor só aceita a conversa com Fulvo de noite e na praça", async () => {
  const atNight = new Date(NIGHT - 60_000).toISOString();
  assert.equal(await PlaceService.canTalk(client("praca", atNight), "u1", "fulvo", NIGHT), true);
  assert.equal(await PlaceService.canTalk(client("estatua_morkhan", atNight), "u1", "fulvo", NIGHT), true);
  const atDay = new Date(DAY - 60_000).toISOString();
  assert.equal(await PlaceService.canTalk(client("praca", atDay), "u1", "fulvo", DAY), false);
  assert.equal(await PlaceService.canTalk(client("laminas", atNight), "u1", "fulvo", NIGHT), false);
});

test("C4: a conversa com o Ciborgue vale da porta da Arena ou do canto dele, de dia ou de noite", async () => {
  for (const now of [DAY, NIGHT]) {
    const at = new Date(now - 60_000).toISOString();
    assert.equal(await PlaceService.canTalk(client("laminas", at), "u1", "ciborgue", now), true);
    assert.equal(await PlaceService.canTalk(client("laminas_fundo", at), "u1", "ciborgue", now), true);
    assert.equal(await PlaceService.canTalk(client("praca", at), "u1", "ciborgue", now), false);
  }
  // visita velha (mais de 1 h) não vale
  const old = new Date(DAY - P.TALK_TTL_MS - 1000).toISOString();
  assert.equal(await PlaceService.canTalk(client("laminas", old), "u1", "ciborgue", DAY), false);
});
