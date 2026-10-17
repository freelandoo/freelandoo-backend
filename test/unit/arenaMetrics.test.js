// Régua de privacidade e períodos das estatísticas da Arena (M08).
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../../src/utils/arenaMetrics");
const { timeState } = require("../../src/services/ArenaStatsService");

test("supressão primária: 0 < v < k some; zero fica (ninguém não identifica)", () => {
  const s = M.suppressCells(new Map([["a", 4], ["b", 0], ["c", 5], ["d", 50]]), 5, { complement: false });
  assert.deepEqual([...s], ["a"]);
});

test("supressão complementar: uma única oculta leva junto a menor visível positiva", () => {
  const s = M.suppressCells(new Map([["a", 1], ["b", 7], ["c", 6], ["d", 0]]));
  assert.deepEqual([...s].sort(), ["a", "c"]);
});

test("complemento desempata pela chave e não acontece com duas ocultas", () => {
  assert.deepEqual([...M.suppressCells(new Map([["x", 2], ["b", 9], ["a", 9]]))].sort(), ["a", "x"]);
  assert.deepEqual([...M.suppressCells(new Map([["x", 2], ["y", 3], ["a", 9]]))].sort(), ["x", "y"]);
});

test("o oculto não é recuperável pela diferença do total", () => {
  const cells = new Map([["br-aa", 2], ["br-bb", 12], ["br-cc", 30]]);
  const total = [...cells.values()].reduce((a, b) => a + b, 0);
  const hidden = M.suppressCells(cells);
  const visibleSum = [...cells].filter(([k]) => !hidden.has(k)).reduce((a, [, v]) => a + v, 0);
  // Sobram pelo menos duas células desconhecidas: a diferença não identifica uma.
  assert.ok(hidden.size >= 2);
  assert.equal(total - visibleSum, 14);
});

test("período: alinhado à granularidade UTC, limitado e ordenado", () => {
  const h = Date.UTC(2026, 9, 17, 10);
  assert.ok(M.parseRange({ from: new Date(h).toISOString(), to: new Date(h + 3_600_000).toISOString() }, "hour").buckets === 1);
  assert.ok(M.parseRange({ from: new Date(h + 60_000).toISOString(), to: new Date(h + 3_600_000).toISOString() }, "hour").error);
  assert.ok(M.parseRange({ from: new Date(h).toISOString(), to: new Date(h + 200 * 3_600_000).toISOString() }, "hour").error);
  assert.ok(M.parseRange({ from: new Date(h).toISOString(), to: new Date(h).toISOString() }, "hour").error);
  assert.ok(M.parseRange({ from: new Date(h).toISOString(), to: new Date(h + 3_600_000).toISOString() }, "day").error);
  assert.ok(M.parseRange({ from: "x", to: "y" }, "hour").error);
});

test("estado do bucket: sem dado antes do início; parcial em curso; final depois", () => {
  const H = 3_600_000;
  const now = new Date(Date.UTC(2026, 9, 17, 12, 30));
  const since = new Date(Date.UTC(2026, 9, 17, 10));
  assert.equal(timeState(Date.UTC(2026, 9, 17, 9), H, now, since), "no_data");
  assert.equal(timeState(Date.UTC(2026, 9, 17, 10), H, now, since), "final");
  assert.equal(timeState(Date.UTC(2026, 9, 17, 12), H, now, since), "partial");
  assert.equal(timeState(Date.UTC(2026, 9, 17, 12), H, now, null), "no_data");
});

test("dicionário: toda métrica declara fonte, fórmula, unidade, aditividade e camada", () => {
  for (const m of M.METRICS) {
    for (const k of ["key", "name", "meaning", "unit", "source", "formula", "granularity", "tier", "dedupe", "limitations"]) assert.ok(m[k] !== undefined, `${m.key}.${k}`);
    assert.equal(typeof m.additive, "boolean");
    assert.ok(["public", "people"].includes(m.tier));
  }
  assert.ok(M.PEOPLE.has("participants") && M.PEOPLE.has("online_avg") && !M.PEOPLE.has("checkpoints"));
});
