// test/unit/companyProspect.test.js
//
// A PROSPECÇÃO (mig 254): normalização, matching, resolução de conflito entre
// fontes e o catálogo de categorias.
//
// É *unit* e não e2e de propósito: os quatro módulos exercitados são PUROS
// (sem I/O, sem require de storage), e é isso que permite provar o coração do
// subsistema sem Postgres e sem rede — inclusive os extratores do crawler, que
// são funções sobre uma string de HTML.
//
// ─── OS DEFEITOS ESCRITOS COMO ASSERÇÃO ─────────────────────────────────────
//
// Todos silenciosos: nenhum deles dá erro em lugar nenhum.
//
//  1. "& vira e antes da pontuação cair" — invertendo a ordem, "Corpo & Ação"
//     vira `corpoacao` e "Corpo e Ação" vira `corpo e acao`: duas chaves de
//     matching para o mesmo nome, e a mesma empresa nasce duas vezes.
//  2. "o 55 só cai quando é o país" — engolindo-o sempre, o fixo do DDD 55
//     (Santa Maria/RS) perde dois dígitos e deixa de casar consigo mesmo.
//  3. "CNPJ diferente derruba o match para zero" — sem isso, duas lojas da
//     mesma rede na mesma rua (nome idêntico, 40 m de distância) viram UMA
//     empresa, e o telefone de uma aparece no card da outra.
//  4. "fonte fraca não sobrescreve fonte forte" — sem a escada, o e-mail do
//     template do site apaga o e-mail da Receita Federal, e o campo continua
//     preenchido com cara de certo.
//  5. "valor vazio nunca vence" — uma fonte forte que não conhece o campo
//     APAGARIA o que uma fraca sabia: é a diferença entre "não sei" e "é vazio".
//  6. "o e-mail do template não entra" — sem a blocklist, a plataforma anuncia
//     o suporte do Wix como contato da padaria, com confiança de fonte oficial.
//  7. "CNPJ do rodapé confere o dígito verificador" — o regex casa com qualquer
//     sequência no formato, inclusive um número de pedido; sem o DV, a empresa
//     seria enriquecida com o cadastro de outra.
//  8. "capital social vem em REAIS e é gravado em CENTAVOS" — sem a conversão,
//     a tela anuncia R$ 500,00 para uma empresa de R$ 50 mil e o filtro de
//     capital não acha ninguém.
//  9. "a QL do Overpass leva TODAS as tags da categoria" — cobrir só a tag
//     "certa" deixa invisível metade dos estabelecimentos, que foram mapeados
//     com a outra.
//
// ─── OS DOIS QUE VIERAM DE SONDA CONTRA A API REAL ──────────────────────────
//
// Nenhum dos dois seria imaginado no papel — os dois apareceram ao rodar os
// providers contra o Nominatim, o Overpass e sites de verdade:
//
// 11. "DDD inexistente não vira telefone" — o crawler extraiu `1064065382` do
//     rodapé de um site real, e o filtro de 10–11 dígitos aceitou. A tela teria
//     anunciado "(10) 6406-5382" como telefone da empresa.
// 12. "'não consegui chegar' não é 'o site me proibiu'" — um domínio do OSM
//     sem registro A nem AAAA voltava marcado como `blocked: "robots"`, e o
//     dono leria na ficha que aquele lead BLOQUEIA a plataforma.

const test = require("node:test");
const assert = require("node:assert");

const N = require("../../src/utils/companyNormalize");
const C = require("../../src/utils/companyConfidence");
const Cat = require("../../src/utils/companyCategories");
const osm = require("../../src/integrations/companyProvider/osm");
const cnpj = require("../../src/integrations/companyProvider/cnpj");
const website = require("../../src/integrations/companyProvider/website");

// ─── NORMALIZAÇÃO ────────────────────────────────────────────────────────────

test("normalizeName: acento, caixa e sufixo societário somem", () => {
  assert.equal(N.normalizeName("CORPO E ACAO ACADEMIA LTDA"), "corpo e acao academia");
  assert.equal(N.normalizeName("Padaria Doze ME"), "padaria doze");
  assert.equal(N.normalizeName("  Óticas  Visão   EIRELI "), "oticas visao");
});

test("normalizeName: '&' vira 'e' ANTES da pontuação cair (defeito 1)", () => {
  // As duas grafias do MESMO nome têm que produzir a MESMA chave. Se o '&'
  // fosse descartado junto com o resto da pontuação, sairiam "corpo acao" e
  // "corpo e acao" — chaves diferentes, e a empresa nasceria duas vezes.
  assert.equal(N.normalizeName("Academia Corpo & Ação"), N.normalizeName("Academia Corpo e Ação"));
  assert.equal(N.normalizeName("Corpo & Ação"), "corpo e acao");
});

test("normalizePhone: o '55' só cai quando é o país (defeito 2)", () => {
  assert.equal(N.normalizePhone("+55 (11) 94330-1234"), "11943301234");
  assert.equal(N.normalizePhone("5511943301234"), "11943301234");
  // DDD 55 (Santa Maria/RS) com fixo: 10 dígitos, o "55" é o DDD e FICA.
  assert.equal(N.normalizePhone("5534991234"), "5534991234");
  assert.equal(N.normalizePhone("123"), null);
});

test("DDD inexistente NÃO vira telefone (defeito 11)", () => {
  // ⚠️ ESTE CASO VEIO DE UMA SONDA CONTRA UM SITE REAL, não de imaginação: o
  // crawler extraiu `1064065382` do rodapé da Smart Fit e o filtro de 10–11
  // dígitos aceitou. A tela teria mostrado "(10) 6406-5382" como telefone da
  // empresa — e o vendedor teria ligado para o nada.
  assert.equal(N.normalizePhone("1064065382"), null)
  assert.equal(N.normalizePhone("2043301234"), null) // DDD 20 não existe
  assert.equal(N.normalizePhone("2343301234"), null) // DDD 23 não existe
  // Sequência decorativa colada no HTML: 1º dígito do assinante é 0 ou 1.
  assert.equal(N.normalizePhone("1100000000"), null)
  // E os válidos continuam passando, inclusive o DDD 55 com fixo.
  assert.equal(N.normalizePhone("1143301234"), "1143301234")
  assert.equal(N.normalizePhone("5534991234"), "5534991234")
  assert.equal(N.normalizePhone("98991380808"), "98991380808")
});

test("isMobilePhone: só 11 dígitos com nono dígito 6-9", () => {
  assert.equal(N.isMobilePhone("11943301234"), true);
  assert.equal(N.isMobilePhone("1143301234"), false); // fixo
  assert.equal(N.isMobilePhone("11143301234"), false); // nono dígito = 1
});

test("normalizeDomain: 'www.' cai, subdomínio real fica", () => {
  assert.equal(N.normalizeDomain("https://www.padariadoze.com.br/contato"), "padariadoze.com.br");
  assert.equal(N.normalizeDomain("loja.padariadoze.com.br"), "loja.padariadoze.com.br");
  assert.equal(N.normalizeDomain("localhost"), null);
  assert.equal(N.normalizeDomain(""), null);
});

test("isValidCnpj: confere o dígito verificador", () => {
  assert.equal(N.isValidCnpj("11.222.333/0001-81"), true);
  assert.equal(N.isValidCnpj("11222333000182"), false);
  assert.equal(N.isValidCnpj("11111111111111"), false); // repetido
});

test("normalizeSocialHandle: perfil de outra rede não vira handle desta", () => {
  assert.equal(N.normalizeSocialHandle("https://instagram.com/padariadoze", "instagram"), "padariadoze");
  assert.equal(N.normalizeSocialHandle("@PadariaDoze", "instagram"), "padariadoze");
  // O link do Facebook no rodapé NÃO pode virar o "Instagram" da empresa.
  assert.equal(N.normalizeSocialHandle("https://facebook.com/padariadoze", "instagram"), null);
  assert.equal(
    N.normalizeSocialHandle("https://linkedin.com/company/padaria-doze", "linkedin"),
    "padaria-doze"
  );
});

// ─── MATCHING ────────────────────────────────────────────────────────────────

test("matchScore: CNPJ igual é identidade", () => {
  const a = { cnpj: "11.222.333/0001-81", display_name: "X" };
  const b = { cnpj: "11222333000181", display_name: "Totalmente Outro Nome" };
  assert.equal(N.matchScore(a, b), 1);
});

test("matchScore: CNPJ diferente derruba tudo para zero (defeito 3)", () => {
  // Duas lojas da MESMA rede, na mesma rua, a 40 m: nome idêntico, telefone
  // idêntico, mesmo CEP. São pessoas jurídicas distintas — e sem esta regra
  // elas virariam UMA empresa, com o telefone de uma no card da outra.
  const a = {
    cnpj: "11222333000181", display_name: "Padaria Doze", phone: "1143301234",
    zip_code: "09854740", latitude: -23.7, longitude: -46.55,
  };
  const b = {
    cnpj: "11222333000262", display_name: "Padaria Doze", phone: "1143301234",
    zip_code: "09854740", latitude: -23.7001, longitude: -46.5501,
  };
  assert.equal(N.matchScore(a, b), 0);
});

test("matchScore: mesmo domínio casa mesmo com nome diferente", () => {
  const a = { display_name: "Corpo e Acao", website: "https://www.corpoeacao.com.br" };
  const b = { display_name: "Academia Corpo & Ação", domain: "corpoeacao.com.br" };
  assert.ok(N.matchScore(a, b) >= N.MATCH_THRESHOLD);
});

test("matchScore: nome genérico em cidades diferentes NÃO funde", () => {
  const a = { display_name: "Auto Center", city: "São Paulo", uf: "SP" };
  const b = { display_name: "Auto Center", city: "Curitiba", uf: "PR" };
  assert.ok(N.matchScore(a, b) < N.MATCH_THRESHOLD);
});

test("matchScore: mesmo nome a 5 km NÃO funde", () => {
  const a = {
    display_name: "Academia Corpo e Acao", city: "São Bernardo do Campo", uf: "SP",
    latitude: -23.70, longitude: -46.55,
  };
  const b = {
    display_name: "Academia Corpo e Acao", city: "São Bernardo do Campo", uf: "SP",
    latitude: -23.75, longitude: -46.55,
  };
  assert.ok(N.matchScore(a, b) < N.MATCH_THRESHOLD);
});

test("haversine: a conta bate com a distância conhecida", () => {
  // ~1,11 km por 0,01 grau de latitude.
  const d = N.haversineMeters(-23.70, -46.55, -23.71, -46.55);
  assert.ok(d > 1050 && d < 1160, `esperava ~1110 m, veio ${d}`);
});

// ─── CONFIANÇA ───────────────────────────────────────────────────────────────

test("fonte fraca NÃO sobrescreve fonte forte (defeito 4)", () => {
  // O rodapé do site tentando apagar o e-mail da Receita.
  assert.equal(
    C.shouldReplace({
      field: "email",
      currentValue: "contato@padariadoze.com.br",
      currentSource: "cnpj",
      nextValue: "suporte@wixpress.com",
      nextSource: "website",
    }),
    false
  );
  // E o caminho inverso: a Receita vence o diretório.
  assert.equal(
    C.shouldReplace({
      field: "email",
      currentValue: "x@directory.com",
      currentSource: "directory",
      nextValue: "contato@padariadoze.com.br",
      nextSource: "cnpj",
    }),
    true
  );
});

test("valor vazio NUNCA vence (defeito 5)", () => {
  assert.equal(
    C.shouldReplace({
      field: "instagram",
      currentValue: "padariadoze",
      currentSource: "website",
      nextValue: null,
      nextSource: "cnpj",
    }),
    false
  );
  assert.equal(
    C.shouldReplace({
      field: "instagram",
      currentValue: "padariadoze",
      currentSource: "website",
      nextValue: "   ",
      nextSource: "cnpj",
    }),
    false
  );
});

test("campo vazio aceita qualquer fonte", () => {
  assert.equal(
    C.shouldReplace({
      field: "phone", currentValue: null, currentSource: null,
      nextValue: "1143301234", nextSource: "directory",
    }),
    true
  );
});

test("o boost por campo inverte a escada onde ela erraria", () => {
  // Coordenada: o OSM tem, a Receita não — e sem o boost a Receita (95) venceria
  // o OSM (65) com um NULL, e a empresa ficaria sem posição no mapa.
  assert.ok(C.fieldConfidence("latitude", "osm") > C.fieldConfidence("latitude", "cnpj"));
  // Já razão social é da Receita, sempre.
  assert.ok(C.fieldConfidence("legal_name", "cnpj") > C.fieldConfidence("legal_name", "website"));
});

test("empate de fonte vai para o valor NOVO (a empresa trocou de telefone)", () => {
  assert.equal(
    C.shouldReplace({
      field: "phone", currentValue: "1143301234", currentSource: "website",
      nextValue: "1143309999", nextSource: "website",
    }),
    true
  );
});

test("scoreCompany: mais canais de contato, nota maior", () => {
  const magra = C.scoreCompany({ display_name: "X" }, {});
  const cheia = C.scoreCompany(
    {
      display_name: "X", phone: "1143301234", whatsapp: "11943301234",
      email: "a@b.com", website: "https://b.com", instagram: "b",
      cnpj: "11222333000181", address: "Rua A", city: "SP", latitude: -23, main_cnae: "5611202",
    },
    { phone: "cnpj", email: "cnpj", cnpj: "cnpj" }
  );
  assert.ok(cheia > magra);
  assert.ok(cheia <= 100 && magra >= 0);
});

// ─── CATÁLOGO ────────────────────────────────────────────────────────────────

test("categoria é lista fechada", () => {
  assert.equal(Cat.isCategory("academia"), true);
  assert.equal(Cat.isCategory("nao-existe"), false);
  assert.ok(Cat.listCategories().length >= 20);
});

test("CNAE vira categoria (o caminho de quem chega pela Receita)", () => {
  assert.equal(Cat.categoryFromCnae("9313100"), "academia");
  assert.equal(Cat.categoryFromCnae("8630-5/01"), "dentista");
  assert.equal(Cat.categoryFromCnae("0000000"), null);
});

test("tags do OSM viram categoria, com a ordem do catálogo desempatando", () => {
  assert.equal(Cat.categoryFromOsmTags({ leisure: "fitness_centre" }), "academia");
  assert.equal(Cat.categoryFromOsmTags({ amenity: "gym" }), "academia");
  // `shop=bakery` vence `amenity=cafe` porque padaria vem antes no catálogo.
  assert.equal(Cat.categoryFromOsmTags({ amenity: "cafe", shop: "bakery" }), "padaria");
  assert.equal(Cat.categoryFromOsmTags({ amenity: "bench" }), null);
});

test("guessCategory: o termo digitado acha a categoria", () => {
  assert.equal(Cat.guessCategory("academias"), "academia");
  assert.equal(Cat.guessCategory("restaurante"), "restaurante");
  assert.equal(Cat.guessCategory("zz"), null);
});

// ─── PROVIDER: OSM ───────────────────────────────────────────────────────────

test("a QL do Overpass leva TODAS as tags da categoria (defeito 9)", () => {
  const ql = osm.buildQuery({ areaId: 3600000001, category: "academia", limit: 50 });
  assert.ok(ql.includes('area(3600000001)->.a;'));
  // As três tags da academia. Cobrir só uma deixaria invisível metade dos
  // estabelecimentos, mapeados com a outra ao longo dos anos.
  assert.ok(ql.includes('nwr["leisure"="fitness_centre"](area.a);'));
  assert.ok(ql.includes('nwr["amenity"="gym"](area.a);'));
  assert.ok(ql.includes('nwr["leisure"="sports_centre"](area.a);'));
  assert.ok(ql.includes("out center tags 50;"));
});

test("a QL recusa categoria desconhecida em vez de montar consulta vazia", () => {
  assert.equal(osm.buildQuery({ areaId: 1, category: "inventada", limit: 10 }), null);
});

test("elemento do OSM vira rascunho normalizado", () => {
  const d = osm.toDraft({
    type: "node",
    id: 123,
    lat: -23.7,
    lon: -46.55,
    tags: {
      name: "Academia Corpo & Ação",
      leisure: "fitness_centre",
      "contact:phone": "+55 (11) 94330-1234",
      website: "www.corpoeacao.com.br",
      "addr:city": "São Bernardo do Campo",
      "addr:state": "SP",
      "addr:postcode": "09854-740",
    },
  });
  assert.equal(d.osm_ref, "node/123");
  assert.equal(d.fields.display_name, "Academia Corpo & Ação");
  assert.equal(d.fields.category_key, "academia");
  assert.equal(d.fields.phone, "11943301234");
  // Celular sem WhatsApp declarado É um WhatsApp em potencial.
  assert.equal(d.fields.whatsapp, "11943301234");
  assert.equal(d.fields.domain, "corpoeacao.com.br");
  assert.equal(d.fields.zip_code, "09854740");
  assert.equal(d.fields.uf, "SP");
});

test("elemento do OSM SEM nome não vira empresa", () => {
  // Ponto mapeado sem `name` é dado geográfico legítimo e lead nenhum: entraria
  // na tela como uma linha em branco que ninguém consegue abordar.
  assert.equal(osm.toDraft({ type: "node", id: 1, lat: 0, lon: 0, tags: { amenity: "gym" } }), null);
});

// ─── PROVIDER: CNPJ ──────────────────────────────────────────────────────────

test("capital social vem em REAIS e é gravado em CENTAVOS (defeito 8)", () => {
  assert.equal(cnpj.capitalToCents(50000), 5_000_000);
  assert.equal(cnpj.capitalToCents("1500.50"), 150_050);
  assert.equal(cnpj.capitalToCents(null), null);
  assert.equal(cnpj.capitalToCents("abc"), null);
});

test("situação cadastral é normalizada (o filtro 'só ativa' depende disso)", () => {
  assert.equal(cnpj.normStatus("ATIVA"), "ativa");
  assert.equal(cnpj.normStatus("Ativa"), "ativa");
  assert.equal(cnpj.normStatus("BAIXADA"), "baixada");
  assert.equal(cnpj.normStatus(""), null);
});

test("porte aceita tanto o código quanto o texto", () => {
  assert.equal(cnpj.normSize(null, "01"), "mei");
  assert.equal(cnpj.normSize("DEMAIS", null), "demais");
  assert.equal(cnpj.normSize("EMPRESA DE PEQUENO PORTE", null), "epp");
});

test("o rascunho da Receita prefere o NOME FANTASIA na tela", () => {
  const d = cnpj.toDraft({
    cnpj: "11222333000181",
    razao_social: "J. R. COMERCIO DE ALIMENTOS LTDA",
    nome_fantasia: "Padaria Doze",
    descricao_situacao_cadastral: "ATIVA",
    capital_social: 50000,
    cnae_fiscal: "1091102",
    identificador_matriz_filial: 1,
    uf: "SP",
    municipio: "SAO BERNARDO DO CAMPO",
  });
  assert.equal(d.fields.display_name, "Padaria Doze");
  assert.equal(d.fields.legal_name, "J. R. COMERCIO DE ALIMENTOS LTDA");
  assert.equal(d.fields.share_capital_cents, 5_000_000);
  assert.equal(d.fields.reg_status, "ativa");
  assert.equal(d.fields.is_headquarters, true);
  assert.equal(d.fields.category_key, "padaria");
});

test("CNPJ sem os 14 dígitos não vira rascunho", () => {
  assert.equal(cnpj.toDraft({ cnpj: "123" }), null);
});

// ─── PROVIDER: SITE ──────────────────────────────────────────────────────────

test("o e-mail do template NÃO entra (defeito 6)", () => {
  const html = `<a href="mailto:suporte@wixpress.com">suporte</a>`;
  assert.equal(website.pickEmail(html, "padariadoze.com.br"), null);
});

test("e-mail do próprio domínio vence o gmail solto no rodapé", () => {
  const html = `
    <p>fale com joao.silva@gmail.com</p>
    <a href="mailto:contato@padariadoze.com.br">contato</a>`;
  assert.equal(website.pickEmail(html, "padariadoze.com.br"), "contato@padariadoze.com.br");
});

test("WhatsApp sai do link wa.me", () => {
  const html = `<a href="https://wa.me/5511943301234">Chame no zap</a>`;
  assert.equal(website.pickWhatsapp(html), "11943301234");
});

test("CNPJ do rodapé confere o dígito verificador (defeito 7)", () => {
  assert.equal(website.pickCnpj("CNPJ 11.222.333/0001-81 — todos os direitos"), "11222333000181");
  // Um número de pedido no formato de CNPJ não vira CNPJ.
  assert.equal(website.pickCnpj("Pedido 11.222.333/0001-99"), null);
});

test("link de compartilhar não vira perfil da empresa", () => {
  const social = website.pickSocials(
    `<a href="https://facebook.com/sharer?u=x">compartilhe</a>
     <a href="https://instagram.com/padariadoze">insta</a>`
  );
  assert.equal(social.facebook, undefined);
  assert.equal(social.instagram, "padariadoze");
});

test("a ordem das páginas do crawl começa pela home e pelo /contato", () => {
  // O teto é de 6 páginas: gastá-las em /about primeiro deixaria de fora
  // justamente onde o contato brasileiro costuma estar.
  assert.equal(website.CANDIDATE_PATHS[0], "/");
  assert.equal(website.CANDIDATE_PATHS[1], "/contato");
});

test("'não consegui chegar' NÃO é 'o site me proibiu' (defeito 12)", async () => {
  // ⚠️ OUTRO ACHADO DA SONDA REAL. Um domínio vindo do OSM sem registro A nem
  // AAAA (site que saiu do ar) voltava marcado como `blocked: "robots"` — e o
  // dono do negócio leria na ficha que aquele lead BLOQUEIA a plataforma,
  // quando a verdade é que o site dele não existe mais. Explicação errada num
  // campo que a tela mostra manda a pessoa resolver o problema errado.
  //
  // Rede privada é OUTRA coisa e continua sendo recusa dura: ali não é "não
  // consegui", é "não vou" — é a trava de SSRF.
  assert.equal(await website.isCrawlAllowed("http://127.0.0.1"), "unsafe")
  assert.equal(await website.isCrawlAllowed("http://169.254.169.254"), "unsafe")
  assert.equal(await website.isCrawlAllowed("ftp://exemplo.com.br"), "unsafe")
  // Host que não resolve: "unreachable", nunca "robots".
  const morto = await website.isCrawlAllowed("https://este-dominio-nao-existe-xyzq.com.br")
  assert.equal(morto, "unreachable")
});

test("anti-SSRF: destino privado e protocolo estranho são recusados", async () => {
  assert.ok((await website.assertPublicUrl("file:///etc/passwd")).error);
  assert.ok((await website.assertPublicUrl("http://127.0.0.1/admin")).error);
  assert.ok((await website.assertPublicUrl("http://169.254.169.254/latest/meta-data/")).error);
  assert.ok((await website.assertPublicUrl("nao-e-url")).error);
});
