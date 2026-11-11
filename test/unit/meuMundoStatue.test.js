// lore v2 N3: domingo na estátua — dia, lugar, meta (D4) e estágios.
const test = require("node:test");
const assert = require("node:assert/strict");
const St = require("../../src/utils/meuMundoStatue");
const Q = require("../../src/utils/meuMundoQuests");

const utc = (s) => Date.parse(s);

test("N3: domingo = o dia todo de Brasília (UTC−3)", () => {
  assert.equal(St.isSunday(utc("2026-11-15T03:00:00Z")), true); // dom 00:00 BRT
  assert.equal(St.isSunday(utc("2026-11-16T02:59:59Z")), true); // dom 23:59:59 BRT
  assert.equal(St.isSunday(utc("2026-11-16T03:00:00Z")), false); // seg 00:00 BRT
  assert.equal(St.isSunday(utc("2026-11-15T02:59:59Z")), false); // sáb 23:59:59 BRT
  assert.equal(St.isSunday(utc("2026-11-11T15:00:00Z")), false);
  assert.equal(St.raceWeek(utc("2026-11-15T12:00:00Z")), "2026-11-15");
  // fora do domingo: o próximo abre no domingo 00:00 BRT; no domingo, o começo de hoje
  assert.equal(St.nextSundayAt(utc("2026-11-11T15:00:00Z")), utc("2026-11-15T03:00:00Z"));
  assert.equal(St.nextSundayAt(utc("2026-11-15T20:00:00Z")), utc("2026-11-15T03:00:00Z"));
  assert.equal(St.sundayEndsAt("2026-11-15"), utc("2026-11-16T03:00:00Z"));
});

test("N3: cada povo entrega na estátua do próprio deus, com visita recente", () => {
  const now = utc("2026-11-15T12:00:00Z");
  const at = (min) => new Date(now - min * 60000).toISOString();
  assert.equal(St.placeOk("raposa", { place: "estatua_aurion", at: at(1) }, now), true);
  assert.equal(St.placeOk("vampiro", { place: "estatua_morkhan", at: at(1) }, now), true);
  assert.equal(St.placeOk("raposa", { place: "estatua_morkhan", at: at(1) }, now), false);
  assert.equal(St.placeOk("vampiro", { place: "estatua_aurion", at: at(1) }, now), false);
  assert.equal(St.placeOk("raposa", { place: "praca", at: at(1) }, now), false);
  assert.equal(St.placeOk("raposa", { place: "estatua_aurion", at: at(11) }, now), false);
  assert.equal(St.placeOk("raposa", null, now), false);
  assert.equal(St.placeOk(null, { place: "estatua_aurion", at: at(1) }, now), false);
});

test("N3: meta = max(base, ativos × por ativo) (D4)", () => {
  const cfg = { baseMl: 30000, perActiveMl: 6000 };
  assert.equal(St.goalFor(0, cfg), 30000);
  assert.equal(St.goalFor(5, cfg), 30000);
  assert.equal(St.goalFor(6, cfg), 36000);
  assert.equal(St.goalFor(100, cfg), 600000);
  assert.equal(St.goalFor(100, { baseMl: 30000, perActiveMl: 0 }), 30000);
  assert.equal(St.goalFor(3), Math.max(St.DEFAULT_CONFIG.baseMl, 3 * St.DEFAULT_CONFIG.perActiveMl));
});

test("N3: estágios 0–4 por quarto da meta", () => {
  assert.equal(St.stageOf(0, 1000), 0);
  assert.equal(St.stageOf(249, 1000), 0);
  assert.equal(St.stageOf(250, 1000), 1);
  assert.equal(St.stageOf(500, 1000), 2);
  assert.equal(St.stageOf(750, 1000), 3);
  assert.equal(St.stageOf(999, 1000), 3);
  assert.equal(St.stageOf(1000, 1000), 4);
  assert.equal(St.stageOf(5000, 1000), 4);
  assert.equal(St.stageOf(100, 0), 0);
  assert.deepEqual(St.STAGES.map((s) => s.id), ["dormindo", "racha", "pedacos", "olhos", "cheia"]);
});

test("N3: config do admin em litros; inválida = null", () => {
  assert.deepEqual(St.parseConfig({ baseL: 30, perActiveL: 6 }), { baseMl: 30000, perActiveMl: 6000 });
  assert.deepEqual(St.parseConfig({ baseL: "12.5", perActiveL: "0" }), { baseMl: 12500, perActiveMl: 0 });
  for (const bad of [{}, { baseL: 0, perActiveL: 1 }, { baseL: 10, perActiveL: -1 }, { baseL: "x", perActiveL: 1 }, { baseL: 1e9, perActiveL: 1 }]) assert.equal(St.parseConfig(bad), null);
});

test("N3: o passo oferenda do cap. 3 é nectar:1 e o check não está mais pendente", () => {
  const cap3 = Q.CHAPTER_BY_ID.get ? Q.CHAPTER_BY_ID.get("cap3") : Q.CHAPTER_BY_ID.cap3;
  assert.equal(cap3.steps.find((s) => s.key === "oferenda").check, "nectar:1");
  assert.ok(!Q.PENDING_CHECKS.includes("nectar"));
  assert.ok(St.KEY_RE.test("abcd1234") && !St.KEY_RE.test("a b") && !St.KEY_RE.test("short"));
});
