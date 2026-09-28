// *Unit*: as regras puras do relatório de mercado local — o recorte, a
// comparação e, principalmente, a NUMERAÇÃO DOS PARÂMETROS (parâmetro sem uso
// derruba a consulta; fora de ordem aponta o filtro para o valor errado).
const test = require("node:test");
const assert = require("node:assert");
const { parseRequest, levelOf, compareLevels, placeSql, baseSql, shapeStats } = require("../../src/utils/marketReport");

test("o recorte mais estreito vence", () => {
  assert.strictEqual(levelOf(parseRequest({})), "country");
  assert.strictEqual(levelOf(parseRequest({ uf: "sp" })), "state");
  assert.strictEqual(levelOf(parseRequest({ uf: "SP", id_region: "69" })), "region");
  assert.strictEqual(levelOf(parseRequest({ uf: "SP", municipio: "Santos", id_region: "69" })), "city");
  assert.strictEqual(
    levelOf(parseRequest({ uf: "SP", municipio: "Santos", id_community: "5907b5cd-dce9-4bc8-b69e-eac7686dd70a" })),
    "community"
  );
});

test("entrada torta alarga o recorte em vez de derrubar", () => {
  const r = parseRequest({ uf: "São Paulo", municipio: "Santos", id_region: "-3", id_community: "x'; drop", kind: "hack" });
  assert.strictEqual(r.uf, null);
  assert.strictEqual(r.municipio, null); // cidade sem estado é ambígua
  assert.strictEqual(r.id_region, null);
  assert.strictEqual(r.id_community, null);
  assert.strictEqual(r.kind, "service");
  assert.strictEqual(levelOf(r), "country");
});

test("a comparação é com os recortes mais largos", () => {
  assert.deepStrictEqual(
    compareLevels("city", { uf: "SP", municipio: "Santos" }).map((c) => c.level),
    ["state", "country"]
  );
  assert.deepStrictEqual(compareLevels("country", {}), []);
  assert.deepStrictEqual(
    compareLevels("community", {}, { uf: "SP", municipio: "Diadema" }).map((c) => c.level),
    ["city", "state", "country"]
  );
});

test("cada parâmetro empurrado é usado, na ordem", () => {
  for (const req of [
    parseRequest({ kind: "service", id_category: "5", uf: "SP", municipio: "Santos" }),
    parseRequest({ kind: "product", id_product_category: "3", id_region: "69" }),
    parseRequest({ kind: "listing", listing_kind: "product", id_community: "5907b5cd-dce9-4bc8-b69e-eac7686dd70a" }),
    parseRequest({ kind: "service" }),
  ]) {
    const params = [];
    const sql = baseSql(req, { level: levelOf(req), ...req }, params);
    for (let i = 1; i <= params.length; i++) assert.ok(sql.includes(`$${i}`), `falta $${i} em ${sql}`);
    assert.ok(!sql.includes(`$${params.length + 1}`));
  }
});

test("o serviço exclui orçamento, preço zero e a categoria fantasma do perfil-conta", () => {
  const sql = baseSql(parseRequest({ kind: "service" }), { level: "country" }, []);
  assert.match(sql, /price_on_request/);
  assert.match(sql, /price_amount > 0/);
  assert.match(sql, /taxonomy_declared_at IS NULL/);
});

test("a vitrine só conta anúncio no ar", () => {
  const sql = baseSql(parseRequest({ kind: "listing" }), { level: "country" }, []);
  assert.match(sql, /paid_until > NOW\(\)/);
  assert.match(sql, /status = 'active'/);
});

test("estatística vazia não inventa número; amostra pequena é marcada", () => {
  assert.deepStrictEqual(shapeStats({ count: 0 }), {
    count: 0, providers: 0, min: null, p25: null, median: null, avg: null, p75: null, max: null, low_sample: false,
  });
  const s = shapeStats({ count: 3, providers: 2, min: 3000, max: 5000, avg: 4000.4, p25: 3500, median: 4000, p75: 4500 });
  assert.strictEqual(s.avg, 4000);
  assert.strictEqual(s.low_sample, true);
});

test("placeSql de comunidade usa a membresia (perfil) ou a própria comunidade (vitrine)", () => {
  const id = "5907b5cd-dce9-4bc8-b69e-eac7686dd70a";
  assert.match(placeSql({ level: "community", id_community: id }, [], "p", "p.id_user"), /tb_community_member/);
  assert.match(placeSql({ level: "community", id_community: id }, [], "c", "l.id_user"), /c\.id_profile/);
});
