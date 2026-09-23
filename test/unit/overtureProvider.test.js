// test/unit/overtureProvider.test.js
// A traducao de uma linha do Overture no rascunho neutro.
//
// `unit` de proposito: `toDraft` e `categoryFromOvertureCategory` sao funcoes
// PURAS — nao ha banco nem rede no caminho, e um teste que precisasse de
// Postgres para conferir uma traducao de campo e um teste que ninguem roda.

const test = require("node:test");
const assert = require("node:assert");

const ov = require("../../src/integrations/companyProvider/overture");
const { categoryFromOvertureCategory } = require("../../src/utils/companyCategories");
const { confidenceOf, fieldConfidence } = require("../../src/utils/companyConfidence");
const { sourceOfPrefix } = require("../../src/integrations/companyProvider/r2Partition");

/** Uma linha como o `build-overture.js` a exporta. */
const linha = (extra = {}) => ({
  id: "abc-123",
  name: "Barbearia 88",
  category: "barber",
  lat: -23.692,
  lon: -46.631,
  phones: ["+5511987347438"],
  websites: null,
  socials: null,
  emails: null,
  address: "Rua José Bonifácio, 535",
  zip: "09910-040",
  ...extra,
});

test("a categoria do Overture vira uma das nossas", () => {
  assert.equal(categoryFromOvertureCategory("barber"), "barbearia");
  assert.equal(categoryFromOvertureCategory("BARBER"), "barbearia");
  assert.equal(categoryFromOvertureCategory("solar_installation"), "energia_solar");
  assert.equal(categoryFromOvertureCategory("plumbing"), "eletricista");
  assert.equal(categoryFromOvertureCategory("church_cathedral"), null);
  assert.equal(categoryFromOvertureCategory(""), null);
  assert.equal(categoryFromOvertureCategory(null), null);
});

test("EXATO vence CURINGA — senao a mesma linha cai em duas categorias", () => {
  // `*_restaurant` pertence a `restaurante`, mas `fast_food_restaurant` e
  // declarado em `bar`, que e onde a lanchonete mora aqui (o OSM ja fazia isso
  // com `amenity=fast_food`). Sem a precedencia, ganharia quem aparecesse
  // primeiro no catalogo — e a classificacao passaria a depender da POSICAO da
  // entrada no arquivo.
  assert.equal(categoryFromOvertureCategory("fast_food_restaurant"), "bar");
  assert.equal(categoryFromOvertureCategory("pizza_restaurant"), "restaurante");
  assert.equal(categoryFromOvertureCategory("restaurant"), "restaurante");
});

test("toDraft: os campos que a tela usa", () => {
  const d = ov.toDraft(linha());
  assert.equal(d.fields.display_name, "Barbearia 88");
  assert.equal(d.fields.category_key, "barbearia");
  assert.equal(d.fields.latitude, -23.692);
  assert.equal(d.fields.address, "Rua José Bonifácio");
  assert.equal(d.fields.address_number, "535");
  assert.equal(d.fields.zip_code, "09910040");
  assert.equal(d.osm_ref, "overture/abc-123");
});

test("linha sem nome ou sem id NAO vira rascunho", () => {
  // Sem nome nao ha o que mostrar; sem id nao ha identidade, e sem identidade
  // o dedupe da particao nao tem por onde pegar — cada reabastecimento criaria
  // a empresa de novo.
  assert.equal(ov.toDraft(linha({ name: "" })), null);
  assert.equal(ov.toDraft(linha({ name: null })), null);
  assert.equal(ov.toDraft(linha({ id: "" })), null);
  assert.equal(ov.toDraft(null), null);
});

test("celular vira WhatsApp; fixo NAO", () => {
  assert.equal(ov.toDraft(linha()).fields.whatsapp, "11987347438");
  const fixo = ov.toDraft(linha({ phones: ["+551133334444"] }));
  assert.equal(fixo.fields.phone, "1133334444");
  assert.equal(fixo.fields.whatsapp, null);
});

test("o link de wa.me VENCE a deducao pelo celular", () => {
  const d = ov.toDraft(linha({
    phones: ["+551133334444"],
    websites: ["https://wa.me/5511999998888"],
  }));
  assert.equal(d.fields.whatsapp, "11999998888");
  // e nao pode ter virado "site"
  assert.equal(d.fields.website, null);
});

test("rede social escondida em `websites` NAO e tratada como site", () => {
  // Medido: 7.749 lugares da regiao metropolitana tem o Instagram em
  // `websites`, e nao em `socials`. Lido como site, o campo `website` da tela
  // apontaria para o Instagram e o Instagram ficaria vazio — errado dos dois
  // lados de uma vez.
  const d = ov.toDraft(linha({ websites: ["https://www.instagram.com/barbearia88"] }));
  assert.equal(d.fields.instagram, "barbearia88");
  assert.equal(d.fields.website, null);
  assert.equal(d.fields.domain, null);
});

test("`socials` vence `websites` para a mesma rede", () => {
  const d = ov.toDraft(linha({
    socials: ["https://instagram.com/oficial"],
    websites: ["https://instagram.com/acidental"],
  }));
  assert.equal(d.fields.instagram, "oficial");
});

test("site de verdade continua sendo site", () => {
  const d = ov.toDraft(linha({
    websites: ["https://barbearia88.com.br", "https://instagram.com/barbearia88"],
  }));
  assert.equal(d.fields.website, "https://barbearia88.com.br");
  assert.equal(d.fields.domain, "barbearia88.com.br");
  assert.equal(d.fields.instagram, "barbearia88");
});

/** O teto de `tb_company.osm_ref` (mig 257). */
const OSM_REF_MAX = 64;

test("a identidade CABE na coluna", () => {
  // ⚠️ ESTE CASO EXISTE PORQUE O ERRO ACONTECEU. A coluna nasceu VARCHAR(32),
  // folgada para `node/123456789`; o GERS id do Overture e um UUID, e
  // `overture/` + 36 da 45 — o INSERT do primeiro lote morreu inteiro com
  // "value too long for type character varying(32)". A mig 257 alargou para
  // 64, e esta assercao e o que impede a proxima fonte de descobrir o teto
  // em producao: se um prefixo novo estourar, quebra aqui.
  const d = ov.toDraft(linha({ id: "1b43fcd8-9e09-4ccc-9599-06e32098c218" }));
  assert.equal(d.osm_ref.length, 45);
  assert.ok(d.osm_ref.length <= OSM_REF_MAX, "osm_ref passou de " + OSM_REF_MAX);
});

test("CNPJ fica NULO — o Overture nao o tem", () => {
  // Nulo e "nao sei". Vazio seria um VALOR, e um valor participa da disputa de
  // campo — poderia apagar o CNPJ que a Receita trouxer depois.
  assert.equal(ov.toDraft(linha()).fields.cnpj, null);
});

test("endereco sem numero reconhecivel fica inteiro na rua", () => {
  const d = ov.toDraft(linha({ address: "Avenida Brasil" }));
  assert.equal(d.fields.address, "Avenida Brasil");
  assert.equal(d.fields.address_number, null);
});

test("a fonte sai do PREFIXO do lote, nunca de um literal", () => {
  assert.equal(sourceOfPrefix("prospect/overture/2026-09"), "overture");
  assert.equal(sourceOfPrefix("prospect/osm/2026-09"), "osm");
  // desconhecido cai em osm, que e o que todo lote anterior a esta mudanca e
  assert.equal(sourceOfPrefix("qualquer/coisa"), "osm");
  assert.equal(sourceOfPrefix(""), "osm");
});

test("a regua de confianca poe o Overture entre o OSM e o site", () => {
  assert.equal(confidenceOf("overture"), 70);
  assert.ok(confidenceOf("overture") > confidenceOf("osm"));
  assert.ok(confidenceOf("overture") < confidenceOf("website"));
  // coordenada e categoria tem que PASSAR a Receita, que nao tem a primeira e
  // declara a atividade FISCAL na segunda
  assert.ok(fieldConfidence("latitude", "overture") > fieldConfidence("latitude", "cnpj"));
  assert.ok(fieldConfidence("category_key", "overture") > fieldConfidence("category_key", "cnpj"));
  // mas o site oficial continua mandando no contato
  assert.ok(fieldConfidence("instagram", "website") > fieldConfidence("instagram", "overture"));
});
