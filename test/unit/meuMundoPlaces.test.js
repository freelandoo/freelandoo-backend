// Lore v2 F4 — pontos de visita e quando a sala grava (utils/meuMundoPlaces.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../../src/utils/meuMundoPlaces");
const C = require("../../src/utils/meuMundoCenter");
const L = require("../../src/utils/meuMundoLayout");
const Q = require("../../src/utils/meuMundoQuests");

test("o ponto mais específico vence: Morkhan dentro da praça", () => {
  assert.equal(P.pickVisit(C.VISIT_POINTS, 0, 6), "estatua_morkhan");
  assert.equal(P.pickVisit(C.VISIT_POINTS, -10, 10), "praca");
  assert.equal(P.pickVisit(C.VISIT_POINTS, C.PORTAL.x, 0), "portal");
  assert.equal(P.pickVisit(C.VISIT_POINTS, -50, 40), null);
  assert.equal(P.pickVisit(L.VISIT_POINTS, 2, 2), "estatua_aurion");
});

test("a porta de cada prédio é um ponto (entrar conta como visita)", () => {
  for (const p of C.PLACES) assert.equal(P.pickVisit(C.VISIT_POINTS, p.interact.x, p.interact.z), p.id, p.id);
});

test("todo visit:<lugar> dos capítulos 1–2 existe num ponto ou na entrada da sala", () => {
  const known = new Set([...C.VISIT_POINTS.map((p) => p.id), ...L.VISIT_POINTS.map((p) => p.id), "bairro", "casa"]);
  for (const ch of Q.CHAPTERS.slice(0, 2))
    for (const s of ch.steps) {
      const { type, arg } = Q.parseCheck(s.check);
      if (type === "visit") assert.ok(known.has(arg), `${ch.id}:${s.key} ${arg}`);
      if (type === "talk") assert.ok(P.NPCS[arg], `${ch.id}:${s.key} ${arg}`);
    }
});

test("lugar dos NPCs é um ponto que a sala conhece", () => {
  const ids = new Set(C.VISIT_POINTS.map((p) => p.id));
  for (const [id, n] of Object.entries(P.NPCS)) for (const pl of n.places) assert.ok(ids.has(pl), `${id} → ${pl}`);
  for (const n of C.STREET_NPCS) {
    assert.ok(P.NPCS[n.id], n.id);
    assert.ok(n.places === undefined);
    // o NPC da rua fica dentro de um lugar dele
    assert.ok(P.NPCS[n.id].places.includes(P.pickVisit(C.VISIT_POINTS, n.x, n.z)), n.id);
    // e tem colisão
    assert.ok(C.OBSTACLES.some((b) => b.x === n.x && b.z === n.z), `${n.id} sem colisão`);
  }
});

test("visitDue: grava na chegada, não repete parado (até 1 min), respeita o intervalo mínimo", () => {
  const s = {};
  assert.equal(P.visitDue(s, "praca", 10_000), "praca");
  assert.equal(P.visitDue(s, "praca", 10_500), null);
  // trocou de ponto cedo demais: espera (e grava na próxima conferência)
  assert.equal(P.visitDue(s, "estatua_morkhan", 11_000), null);
  assert.equal(P.visitDue(s, "estatua_morkhan", 13_100), "estatua_morkhan");
  // parado no mesmo ponto: só depois de VISIT_REPEAT_MS
  assert.equal(P.visitDue(s, "estatua_morkhan", 13_100 + P.VISIT_REPEAT_MS - 1), null);
  assert.equal(P.visitDue(s, "estatua_morkhan", 13_100 + P.VISIT_REPEAT_MS), "estatua_morkhan");
  // saiu e voltou: grava de novo
  assert.equal(P.visitDue(s, null, 200_000), null);
  assert.equal(P.visitDue(s, "estatua_morkhan", 200_500), "estatua_morkhan");
});

test("visit/talk saíram da lista de pendentes; talk é marca aceita", () => {
  assert.ok(!Q.PENDING_CHECKS.includes("visit"));
  assert.ok(!Q.PENDING_CHECKS.includes("talk"));
  assert.ok(Q.MARKS.includes("talk"));
});
