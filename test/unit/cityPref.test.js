// Minha cidade (mig 468) — a preferência de moradia e o pill único.
const test = require("node:test");
const assert = require("node:assert");

const { normalizeCityPrefInput, mergeBairros, TAB_OF_HOUSING } = require("../../src/utils/cityPref");
const { normalizeQuickPills } = require("../../src/utils/quickPills");

test("preferência aceita só casa/condomínio e as duas abas", () => {
  assert.deepStrictEqual(normalizeCityPrefInput({ housing_kind: "house" }), { value: { housing_kind: "house" } });
  assert.deepStrictEqual(normalizeCityPrefInput({ last_tab: "condominio" }), { value: { last_tab: "condominio" } });
  assert.deepStrictEqual(normalizeCityPrefInput({ housing_kind: "condo", last_tab: "bairro" }), {
    value: { housing_kind: "condo", last_tab: "bairro" },
  });
  assert.ok(normalizeCityPrefInput({ housing_kind: "apartamento" }).error);
  assert.ok(normalizeCityPrefInput({ last_tab: "cidade" }).error);
  assert.ok(normalizeCityPrefInput({}).error, "corpo vazio não grava nada");
  assert.ok(normalizeCityPrefInput(null).error);
  assert.ok(normalizeCityPrefInput([]).error);
});

test("campos extras do corpo são ignorados (não viram coluna)", () => {
  const r = normalizeCityPrefInput({ housing_kind: "house", id_user: "outro", id_profile: "x" });
  assert.deepStrictEqual(r, { value: { housing_kind: "house" } });
});

test("cada moradia abre a sua aba", () => {
  assert.strictEqual(TAB_OF_HOUSING.house, "bairro");
  assert.strictEqual(TAB_OF_HOUSING.condo, "condominio");
});

test("bairro por residência e por membresia viram uma linha por comunidade", () => {
  const res = [
    { id_territory: 1, bairro_label: "Bela Vista", municipio_label: "São Paulo", uf: "SP", residence_status: "recognized", id_profile: "A", display_name: "Bela Vista", is_member: true, role: "member" },
    { id_territory: 2, bairro_label: "Itaim", municipio_label: "São Paulo", uf: "SP", residence_status: "pending", id_profile: null, is_member: false },
  ];
  const members = [
    { id_profile: "A", display_name: "Bela Vista", role: "member" },
    { id_profile: "B", display_name: "Bairro antigo", role: "member" },
  ];
  const out = mergeBairros(res, members);
  assert.strictEqual(out.length, 3);
  assert.deepStrictEqual(out.map((r) => r.id_profile), ["A", null, "B"]);
  assert.strictEqual(out[0].residence_status, "recognized");
  assert.strictEqual(out[1].id_territory, 2, "território sem comunidade continua aparecendo");
  assert.strictEqual(out[2].residence_status, null, "quem se mudou continua achando a comunidade antiga");
  assert.strictEqual(out[2].is_member, true);
});

test("pill: condomínio e bairro antigos viram UM pill Minha cidade", () => {
  assert.deepStrictEqual(normalizeQuickPills(["wallet", "condo", "neighborhood", "games"]), ["wallet", "city", "games"]);
  assert.deepStrictEqual(normalizeQuickPills(["neighborhood"]), ["city"]);
  assert.deepStrictEqual(normalizeQuickPills(["city", "condo"]), ["city"]);
  assert.deepStrictEqual(normalizeQuickPills(["business", "wallet", "fitness", "games", "city"]).length, 4);
});
