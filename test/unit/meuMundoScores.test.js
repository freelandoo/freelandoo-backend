// lore v2 N1: o placar semanal — a semana de Brasília, como cada jogo conta e o
// medidor das salas levando a marca até o serviço.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const S = require("../../src/utils/meuMundoScores");

const utc = (s) => Date.parse(s);

test("N1: a semana vai de domingo 00:00 a sábado 23:59 em Brasília (UTC−3)", () => {
  // domingo 2026-11-08 00:00 BRT = 03:00 UTC
  assert.equal(S.weekOf(utc("2026-11-08T03:00:00Z")), "2026-11-08");
  // um minuto antes ainda é sábado 23:59 da semana anterior
  assert.equal(S.weekOf(utc("2026-11-08T02:59:00Z")), "2026-11-01");
  // quarta e sábado à noite caem na mesma semana
  assert.equal(S.weekOf(utc("2026-11-11T15:00:00Z")), "2026-11-08");
  assert.equal(S.weekOf(utc("2026-11-15T02:59:59Z")), "2026-11-08");
  assert.equal(S.weekOf(utc("2026-11-15T03:00:00Z")), "2026-11-15");
  // virada de ano
  assert.equal(S.weekOf(utc("2027-01-01T12:00:00Z")), "2026-12-27");
  const r = S.weekRange("2026-11-08");
  assert.equal(new Date(r.start).toISOString(), "2026-11-08T03:00:00.000Z");
  assert.equal(r.end - r.start, 7 * 24 * 3600 * 1000);
  assert.equal(S.previousWeek("2026-11-08"), "2026-11-01");
  assert.ok(S.isWeekId("2026-11-08"));
  assert.ok(!S.isWeekId("2026-11-09"), "segunda não é id de semana");
  assert.ok(!S.isWeekId("x"));
});

test("N1: os jogáveis do placar e como cada um conta", () => {
  assert.deepEqual(
    S.GAMES.map((g) => g.id),
    ["jetpack", "noturno", "corrida", "gincana", "paint", "laminas", "boxe", "hall", "poder"]
  );
  // o Poder não grava (é o número de agora); os outros batem com o CHECK da mig 440
  assert.ok(!S.STORED.includes("poder"));
  const fs = require("fs");
  const sql = fs.readFileSync(path.join(__dirname, "../../src/databases/migrations/440_meu_mundo_placar.sql"), "utf8");
  const m = sql.match(/game IN \(([^)]*)\)/);
  assert.deepEqual(m[1].split(",").map((x) => x.trim().replace(/'/g, "")), S.STORED);
  // pontos: maior vence; tempo: menor vence; empate não troca
  assert.equal(S.better("jetpack", 10, 9), true);
  assert.equal(S.better("jetpack", 9, 9), false);
  assert.equal(S.better("corrida", 59000, 61000), true);
  assert.equal(S.better("corrida", 61000, 59000), false);
  assert.equal(S.better("corrida", 1, null), true);
});

test("N1: marca válida — tempo zero, negativo, lixo e o Poder não gravam", () => {
  assert.equal(S.markOf("jetpack", 512.4), 512);
  assert.equal(S.markOf("paint", 0), 0);
  assert.equal(S.markOf("corrida", 0), null);
  assert.equal(S.markOf("corrida", 61234.6), 61235);
  assert.equal(S.markOf("jetpack", -1), null);
  assert.equal(S.markOf("jetpack", "abc"), null);
  assert.equal(S.markOf("jetpack", Infinity), null);
  assert.equal(S.markOf("poder", 100), null);
  assert.equal(S.markOf("xadrez", 1), null);
  assert.equal(S.markOf("hall", 1.9), 1);
});

test("N1: o medidor da sala entrega a marca de cada pessoa (e quem saiu no meio vai sem)", async () => {
  const svc = path.join(__dirname, "../../src/services/MeuMundoAdventureService.js");
  const calls = [];
  const old = require.cache[require.resolve(svc)];
  require.cache[require.resolve(svc)] = {
    id: svc,
    filename: svc,
    loaded: true,
    exports: { creditMinigame: async (id, o) => (calls.push([id, o]), { receipt: null }) },
  };
  try {
    const { PracticeMeter } = require("../../src/realtime/meuMundoPractice");
    const m = new PracticeMeter("jetpack", "sala:1", null);
    m.pose("a", { x: 1 }, 1000);
    m.pose("a", { x: 2 }, 1500);
    m.pose("b", { x: 1 }, 1000);
    m.pose("b", { x: 3 }, 1600);
    m.pose("c", { x: 1 }, 1000);
    m.pose("c", { x: 4 }, 1700);
    m.settle("c"); // saiu no meio
    m.settle(null, new Set(["a"]), new Map([["a", 900], ["b", 400], ["c", 9999]]));
    const by = Object.fromEntries(calls.map(([id, o]) => [id, o]));
    assert.equal(by.a.score, 900);
    assert.equal(by.a.win, true);
    assert.equal(by.b.score, 400);
    assert.equal(by.c.score, null, "quem saiu no meio já foi entregue sem marca");
    assert.equal(calls.length, 3);
  } finally {
    if (old) require.cache[require.resolve(svc)] = old;
    else delete require.cache[require.resolve(svc)];
  }
});
