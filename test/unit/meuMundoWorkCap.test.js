// A7: o trabalho no Meu Mundo rende Esmeralda com teto próprio por dia de
// Brasília (RULES.WORK_COINS_DAY, ou o `workCap` que a carteira traz).
const test = require("node:test");
const assert = require("node:assert/strict");
const Life = require("../../src/utils/meuMundoLife");

function worker(capOverride) {
  const t0 = Date.UTC(2026, 10, 9, 11, 0, 0); // 08:00 em Brasília
  const s = Life.birth(424242, t0);
  s.intelligence = 1000;
  for (const k of Object.keys(s.peaks || {})) s.peaks[k] = Math.max(s.peaks[k], 1000);
  const wallet = { coins: 0, ...(capOverride != null ? { workCap: capOverride } : {}) };
  return { s, t0, wallet };
}

test("trabalho rende no máximo o teto do dia", () => {
  const { s, t0, wallet } = worker();
  // Dois turnos seguidos (o máximo de um é menor que 12 h).
  const r1 = Life.startActivity(s, "working", 8, t0);
  assert.ok(r1.ok, JSON.stringify(r1));
  const mid = Life.simulate(s, t0 + 8 * 3600e3, wallet, {});
  const r2 = Life.startActivity(s, "working", 4, t0 + 8 * 3600e3);
  assert.ok(r2.ok, JSON.stringify(r2));
  const sim2 = Life.simulate(s, t0 + 12 * 3600e3, wallet, {});
  const sim = { earned: mid.earned + sim2.earned };
  assert.ok(sim.earned > 0, "trabalhou");
  assert.ok(sim.earned <= Life.RULES.WORK_COINS_DAY + 1e-9, String(sim.earned));
  assert.equal(Life.RULES.WORK_COINS_DAY, 150);
});

test("o teto vem da carteira quando o admin muda", () => {
  const { s, t0, wallet } = worker(20);
  // Dois turnos seguidos (o máximo de um é menor que 12 h).
  const r1 = Life.startActivity(s, "working", 8, t0);
  assert.ok(r1.ok, JSON.stringify(r1));
  const mid = Life.simulate(s, t0 + 8 * 3600e3, wallet, {});
  const r2 = Life.startActivity(s, "working", 4, t0 + 8 * 3600e3);
  assert.ok(r2.ok, JSON.stringify(r2));
  const sim2 = Life.simulate(s, t0 + 12 * 3600e3, wallet, {});
  const sim = { earned: mid.earned + sim2.earned };
  assert.ok(sim.earned > 0, "trabalhou");
  assert.ok(sim.earned <= 20 + 1e-9, String(sim.earned));
});
