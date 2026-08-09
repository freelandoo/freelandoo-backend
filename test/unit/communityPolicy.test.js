// test/unit/communityPolicy.test.js
const test = require("node:test");
const assert = require("node:assert");

const {
  TIER,
  policyFor,
  resolveTier,
  can,
  projectCommunity,
  COUNTER_FIELDS,
} = require("../../src/utils/communityPolicy");

test("policyFor: condomínio é territorial, independente de privacy", () => {
  assert.strictEqual(policyFor({ kind: "condo", privacy: "public" }).id, "territorial");
  assert.strictEqual(policyFor({ kind: "condo", privacy: "private" }).id, "territorial");
});

test("policyFor: temática pública x privada", () => {
  assert.strictEqual(policyFor({ kind: "common", privacy: "public" }).id, "thematic_public");
  assert.strictEqual(policyFor({ kind: "common", privacy: "private" }).id, "thematic_private");
});

test("policyFor: modalidade desconhecida cai no mais restrito", () => {
  assert.strictEqual(policyFor({ kind: "surpresa", privacy: "public" }).id, "territorial");
  assert.strictEqual(policyFor(null).id, "territorial");
});

test("resolveTier: escada completa", () => {
  assert.strictEqual(resolveTier({}), TIER.anonymous);
  assert.strictEqual(resolveTier({ viewer: { id_user: "u1" } }), TIER.outsider);
  assert.strictEqual(
    resolveTier({ viewer: { id_user: "u1" }, membership: { role: "member" } }),
    TIER.member,
  );
  assert.strictEqual(
    resolveTier({ viewer: { id_user: "u1" }, membership: { role: "member" }, isResident: true }),
    TIER.resident,
  );
  assert.strictEqual(
    resolveTier({ viewer: { id_user: "u1" }, membership: { role: "vice" } }),
    TIER.manager,
  );
  assert.strictEqual(
    resolveTier({ viewer: { id_user: "u1" }, membership: { role: "leader" } }),
    TIER.manager,
  );
});

test("resolveTier: gestor vence morador", () => {
  assert.strictEqual(
    resolveTier({ viewer: { id_user: "u1" }, membership: { role: "leader" }, isResident: true }),
    TIER.manager,
  );
});

test("can: negação por padrão para recurso desconhecido", () => {
  const policy = policyFor({ kind: "common", privacy: "public" });
  assert.strictEqual(can(policy, "recurso_inexistente", TIER.manager), false);
});

test("can: temática pública libera tudo para anônimo", () => {
  const policy = policyFor({ kind: "common", privacy: "public" });
  for (const r of ["counters", "memberList", "goal", "benchmark"]) {
    assert.strictEqual(can(policy, r, TIER.anonymous), true, r);
  }
});

test("can: temática privada exige membro", () => {
  const policy = policyFor({ kind: "common", privacy: "private" });
  assert.strictEqual(can(policy, "memberList", TIER.outsider), false);
  assert.strictEqual(can(policy, "memberList", TIER.member), true);
  assert.strictEqual(can(policy, "goal", TIER.outsider), false);
  assert.strictEqual(can(policy, "goal", TIER.member), true);
});

test("can: territorial exige morador para lista e metas, membro para contadores", () => {
  const policy = policyFor({ kind: "condo", privacy: "public" });
  assert.strictEqual(can(policy, "counters", TIER.outsider), false);
  assert.strictEqual(can(policy, "counters", TIER.member), true);
  assert.strictEqual(can(policy, "memberList", TIER.member), false);
  assert.strictEqual(can(policy, "memberList", TIER.resident), true);
  assert.strictEqual(can(policy, "memberList", TIER.manager), true);
  assert.strictEqual(can(policy, "goal", TIER.member), false);
  assert.strictEqual(can(policy, "goal", TIER.resident), true);
});

test("projectCommunity: forasteiro em condomínio não recebe contadores", () => {
  const row = {
    id_profile: "p1",
    kind: "condo",
    privacy: "public",
    display_name: "Ed. Aurora",
    member_count: 42,
    xp_total: 999,
    xp_level: 7,
  };
  const out = projectCommunity(row, TIER.outsider);
  for (const f of COUNTER_FIELDS) {
    assert.strictEqual(f in out, false, `${f} vazou`);
  }
  assert.strictEqual(out.display_name, "Ed. Aurora");
});

test("projectCommunity: membro de condomínio recebe contadores", () => {
  const row = { id_profile: "p1", kind: "condo", privacy: "public", member_count: 42, xp_total: 9, xp_level: 1 };
  const out = projectCommunity(row, TIER.member);
  assert.strictEqual(out.member_count, 42);
});

test("projectCommunity: temática pública mantém contadores para anônimo", () => {
  const row = { id_profile: "p1", kind: "common", privacy: "public", member_count: 42, xp_total: 9, xp_level: 1 };
  const out = projectCommunity(row, TIER.anonymous);
  assert.strictEqual(out.member_count, 42);
  assert.strictEqual(out.xp_level, 1);
});

test("projectCommunity: não muta a linha original", () => {
  const row = { id_profile: "p1", kind: "condo", privacy: "public", member_count: 42 };
  projectCommunity(row, TIER.outsider);
  assert.strictEqual(row.member_count, 42);
});
