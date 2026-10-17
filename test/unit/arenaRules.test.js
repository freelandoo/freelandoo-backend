const test = require("node:test");
const assert = require("node:assert");
const rules = require("../../src/utils/arenaRules");
const { validateCatalog } = require("../../src/services/ArenaCatalogSync");
const catalog = require("../../src/databases/seeds/arena-catalog.json");

test("playerId é público, opaco e no formato do contrato", () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const id = rules.newPlayerId();
    assert.ok(rules.isPlayerId(id), id);
    assert.equal(id.length, 23);
    seen.add(id);
  }
  assert.equal(seen.size, 500);
});

test("pickBody recusa campo não declarado (atribuição em massa)", () => {
  assert.deepEqual(rules.pickBody({ teamId: "rock" }, ["teamId"]), { ok: true, value: { teamId: "rock" } });
  assert.deepEqual(rules.pickBody({ teamId: "rock", id_user: "x" }, ["teamId"]), { ok: false, field: "id_user" });
  assert.equal(rules.pickBody([1], ["teamId"]).ok, false);
  assert.deepEqual(rules.pickBody(undefined, ["x"]), { ok: true, value: {} });
});

test("ids seguem o formato slug do contrato", () => {
  assert.ok(rules.isCategoryId("musica"));
  assert.ok(!rules.isCategoryId("Musica"));
  assert.ok(!rules.isCategoryId("m"));
  assert.ok(!rules.isTeamId("rock;drop"));
  assert.ok(rules.isTeamId("samba-pagode"));
});

test("disponibilidade: inativa > política pendente > sem equipes > disponível", () => {
  const a = rules.categoryAvailability;
  assert.equal(a({ isActive: false, isSensitive: true, consentPolicyVersion: null, activeTeamCount: 3 }), "inactive");
  assert.equal(a({ isActive: true, isSensitive: true, consentPolicyVersion: null, activeTeamCount: 3 }), "awaiting_policy");
  assert.equal(a({ isActive: true, isSensitive: true, consentPolicyVersion: 1, activeTeamCount: 0 }), "no_teams");
  assert.equal(a({ isActive: true, isSensitive: false, consentPolicyVersion: null, activeTeamCount: 2 }), "available");
});

test("nome público sai do username, nunca do nome civil, e sem caracteres de controle", () => {
  assert.equal(rules.publicDisplayName("alex\u0000<b>"), "alexb");
  assert.equal(rules.publicDisplayName(""), null);
  assert.equal(rules.publicDisplayName("x".repeat(80)).length, 40);
});

test("o catálogo de produção é válido e tem as cinco categorias", () => {
  assert.deepEqual(validateCatalog(catalog), []);
  const ids = catalog.categories.map((c) => c.categoryId).sort();
  assert.deepEqual(ids, ["anime", "futebol", "musica", "politica", "series"]);
  const pol = catalog.categories.find((c) => c.categoryId === "politica");
  assert.equal(pol.sensitive, true);
  // Política sem versão aprovada = coleta desligada em produção.
  assert.equal(pol.consentPolicyVersion, null);
});

test("validateCatalog acusa equipe repetida, cor e rótulo inválidos", () => {
  const bad = {
    categories: [
      { categoryId: "x1", sensitive: false, labels: { "pt-BR": "X" }, color: "red", teams: [
        { teamId: "a1", labels: { "pt-BR": "A" } },
        { teamId: "a1", labels: { fr: "A" } },
      ] },
    ],
  };
  const errs = validateCatalog(bad);
  assert.ok(errs.some((e) => e.includes("cor")));
  assert.ok(errs.some((e) => e.includes("repetida")));
  assert.ok(errs.some((e) => e.includes("labels")));
});
