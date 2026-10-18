// Regras puras das missões, XP da Arena e x2 (M12).
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../../src/utils/arenaMissions");
const CONFIG = require("../../src/databases/seeds/arena-missions.json");

test("ciclo diário UTC pelo instante do fato; virada exata", () => {
  assert.equal(M.cycleKeyOf(Date.parse("2026-10-17T23:59:59.999Z")), "2026-10-17");
  assert.equal(M.cycleKeyOf(Date.parse("2026-10-18T00:00:00.000Z")), "2026-10-18");
  const b = M.cycleBounds(Date.parse("2026-10-18T10:00:00Z"));
  assert.equal(b.startsAt, "2026-10-18T00:00:00.000Z");
  assert.equal(b.endsAt, "2026-10-19T00:00:00.000Z");
});

test("contribuição: 'count' deduplica o fato; 'distinct' deduplica o poste", () => {
  const f = (id, post) => ({ id_fact: id, fact_type: "post_visited", environment_id: "br-sp", payload: { postId: post } });
  assert.equal(M.contribKey({ objective: "count" }, f(1, "a")), "f:1");
  assert.equal(M.contribKey({ objective: "distinct" }, f(1, "a")), M.contribKey({ objective: "distinct" }, f(2, "a")));
  assert.notEqual(M.contribKey({ objective: "distinct" }, f(1, "a")), M.contribKey({ objective: "distinct" }, f(1, "b")));
});

test("níveis V1 a partir da configuração", () => {
  assert.deepEqual(M.levelOf(0, CONFIG.levels), { level: 1, levelStartXp: 0, nextLevelXp: 100 });
  assert.equal(M.levelOf(99, CONFIG.levels).level, 1);
  assert.equal(M.levelOf(100, CONFIG.levels).level, 2);
  assert.equal(M.levelOf(3200, CONFIG.levels).level, 10);
  assert.deepEqual(M.levelOf(4000, CONFIG.levels), { level: 11, levelStartXp: 4000, nextLevelXp: 4800 });
});

const policy = CONFIG.boost;
const T = Date.parse("2026-10-18T12:00:00Z");

test("x2: desligado, ativo, limite diário e cooldown", () => {
  const base = { enabled: true, policy, nowMs: T, todayCount: 0, lastStartsAtMs: null, activeUntilMs: null };
  assert.equal(M.boostDecision({ ...base, enabled: false }).reason, "disabled");
  assert.equal(M.boostDecision({ ...base, activeUntilMs: T + 1 }).reason, "already_active");
  assert.equal(M.boostDecision({ ...base, todayCount: 3 }).reason, "daily_limit");
  assert.equal(M.boostDecision({ ...base, lastStartsAtMs: T - 29 * 60_000 }).reason, "cooldown");
  const ok = M.boostDecision({ ...base, lastStartsAtMs: T - 30 * 60_000 });
  assert.equal(ok.ok, true);
  assert.equal(ok.expiresAtMs - ok.startsAtMs, 10 * 60_000);
});

test("fator: pelo instante do fato, sem retroatividade, nunca acima de 2", () => {
  const boost = { id_boost: "b", starts_at: "2026-10-18T12:00:00Z", expires_at: "2026-10-18T12:10:00Z", revoked_at: null };
  const elig = { x2_eligible: true };
  assert.equal(M.factorFor(elig, boost, Date.parse("2026-10-18T11:59:59Z")).factor, 1, "fato anterior à ativação");
  assert.equal(M.factorFor(elig, boost, Date.parse("2026-10-18T12:00:00Z")).factor, 2, "início inclusivo");
  assert.equal(M.factorFor(elig, boost, Date.parse("2026-10-18T12:10:00Z")).factor, 1, "expiração exata não multiplica");
  assert.equal(M.factorFor({ x2_eligible: false }, boost, Date.parse("2026-10-18T12:05:00Z")).factor, 1, "missão não elegível");
  assert.equal(M.factorFor(elig, { ...boost, revoked_at: "x" }, Date.parse("2026-10-18T12:05:00Z")).factor, 1);
});

test("catálogo V1 é válido; missão do vídeo com x2 é recusada; expressão não existe", () => {
  assert.ok(M.validateMissionsDoc(CONFIG).value);
  const bad = JSON.parse(JSON.stringify(CONFIG));
  bad.missions.find((m) => m.factType === "video_completed").x2Eligible = true;
  assert.ok(M.validateMissionsDoc(bad).errors.some((e) => e.includes("multiplicada")));
  const bad2 = JSON.parse(JSON.stringify(CONFIG));
  bad2.missions[0].factType = "message_sent";
  assert.ok(M.validateMissionsDoc(bad2).errors);
  const bad3 = JSON.parse(JSON.stringify(CONFIG));
  bad3.boost.factor = 4;
  assert.ok(M.validateMissionsDoc(bad3).errors);
});

test("disponibilidade: checkpoint fica indisponível sem poste competitivo", () => {
  const ck = CONFIG.missions.find((m) => m.missionKey === "checkpoint-daily");
  const def = { status: ck.status, requirement: ck.requirement };
  assert.equal(M.availability(def, { competitivePosts: false, videoCampaign: true, gameServer: true }), "competitive_closed");
  assert.equal(M.availability(def, { competitivePosts: true, videoCampaign: true, gameServer: true }), "available");
  assert.equal(M.availability({ status: "disabled", requirement: "none" }, {}), "disabled");
});
