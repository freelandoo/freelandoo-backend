// O SITE FEITO PELA FREELANDOO (mig 241) — a forma dos dados e a brecha.
//
// Unit e não e2e de propósito: `normalizeTemplateData` é função pura, e ela é a
// FRONTEIRA DE CONFIANÇA de tudo que vira HTML e href no site de um cliente,
// sob o domínio dele. Os guards de escrita dependem dela estar certa.
//
// A última bateria é de outra natureza: ela escreve A BRECHA COMO ASSERÇÃO. A
// promessa "só a plataforma insere site aqui" se apoia em três coisas que
// ninguém vê ao ler uma linha isolada — e um refactor bem-intencionado desfaz
// qualquer uma delas sem produzir erro nenhum. O teste quebra no lugar do
// usuário.

const test = require("node:test");
const assert = require("node:assert");

const {
  TEMPLATE_SLUGS,
  isTemplate,
  normalizeTemplateData,
  LIMITS,
} = require("../../src/utils/siteTemplates");
const { isManaged, managedRefusal } = require("../../src/utils/managedSite");
const { USER_FEATURE_KEYS } = require("../../src/utils/userFeatureKeys");
const CommunitySiteStorage = require("../../src/storages/CommunitySiteStorage");

/** Montado, nunca escrito — fonte com byte NUL vira binário para o git. */
const NUL = String.fromCharCode(0);

/** Um serviço mínimo e válido, para os testes mexerem só no que interessa. */
function servico(over = {}) {
  return { slug: "conserto-de-fogoes", label: "Conserto de fogões", ...over };
}

// ─── O registro ─────────────────────────────────────────────────────────────

test("o tema tem que existir — recusa em voz alta, nunca cai num tema qualquer", () => {
  assert.strictEqual(isTemplate("oficina-local"), true);
  for (const t of ["barbearia", "", null, undefined, "OFICINA-LOCAL", "__proto__"]) {
    assert.strictEqual(isTemplate(t), false, String(t));
  }
  const out = normalizeTemplateData("barbearia", {});
  assert.ok(out.error, "tema desconhecido tem que devolver erro");
  assert.ok(!out.data, "e não pode devolver dados normalizados por engano");
});

test("os temas do backend são os que o front sabe desenhar", () => {
  // Se esta lista mudar, o espelho `lib/site-templates.ts` muda junto. Tema só
  // aqui = dados que a página não sabe montar; tema só lá = save recusado.
  assert.deepStrictEqual(TEMPLATE_SLUGS, ["oficina-local"]);
});

// ─── A fronteira de confiança ───────────────────────────────────────────────

test("link perigoso vira vazio — javascript: e data: num href são XSS no clique", () => {
  const { data } = normalizeTemplateData("oficina-local", {
    googleProfileUrl: "javascript:alert(1)",
    business: { heroPhoto: "javascript:alert(2)" },
    services: [servico({ photo: "data:text/html;base64,PHNjcmlwdD4=" })],
  });
  assert.strictEqual(data.googleProfileUrl, "");
  // O retrato do banner termina num `src` renderizado no domínio do cliente:
  // ele passa pela MESMA régua das outras URLs, não por uma própria.
  assert.strictEqual(data.business.heroPhoto, "");
  assert.strictEqual(data.services[0].photo, "");
});

test("//outro.site é recusado: parece caminho interno e é endereço externo", () => {
  const { data } = normalizeTemplateData("oficina-local", {
    googleProfileUrl: "//evil.example.com/x",
  });
  assert.strictEqual(data.googleProfileUrl, "");
});

test("http, https, tel, mailto e caminho interno passam", () => {
  for (const url of [
    "https://maps.google.com/x",
    "http://exemplo.com.br",
    "tel:+5519994957125",
    "mailto:contato@exemplo.com",
    "/images/servicos/fogao.jpg",
  ]) {
    const { data } = normalizeTemplateData("oficina-local", { googleProfileUrl: url });
    assert.strictEqual(data.googleProfileUrl, url, url);
  }
});

test("byte nulo sai — é o único caractere que quebra o JSONB do Postgres", () => {
  const { data } = normalizeTemplateData("oficina-local", {
    business: { name: "Ricardo" + NUL + " Fogões" },
  });
  assert.strictEqual(data.business.name, "Ricardo Fogões");
  assert.ok(!JSON.stringify(data).includes(NUL));
});

test("chave desconhecida é DESCARTADA, não gravada", () => {
  const { data } = normalizeTemplateData("oficina-local", {
    business: { name: "X", cnpjSecreto: "123", __proto__: { poluido: true } },
    inventado: "nao deveria ficar",
  });
  assert.ok(!("inventado" in data));
  assert.ok(!("cnpjSecreto" in data.business));
  assert.strictEqual(data.poluido, undefined);
});

test("serviço sem endereço ou sem nome é descartado — item de menu que não leva a lugar nenhum", () => {
  const { data } = normalizeTemplateData("oficina-local", {
    services: [
      servico(),
      servico({ slug: "Conserto De Fogões" }), // maiúscula e espaço não é slug
      servico({ slug: "valido-2", label: "" }),
      servico({ slug: "../../etc/passwd" }),
      servico({ slug: "ok-3" }),
    ],
  });
  assert.deepStrictEqual(
    data.services.map((s) => s.slug),
    ["conserto-de-fogoes", "ok-3"]
  );
});

test("endereço repetido: fica o primeiro — duas páginas na mesma URL seriam decididas pela ordem do array", () => {
  const { data } = normalizeTemplateData("oficina-local", {
    services: [servico({ label: "Primeiro" }), servico({ label: "Segundo" })],
    cities: [
      { slug: "aguai", name: "Aguaí" },
      { slug: "aguai", name: "Aguaí (de novo)" },
    ],
  });
  assert.strictEqual(data.services.length, 1);
  assert.strictEqual(data.services[0].label, "Primeiro");
  assert.strictEqual(data.cities.length, 1);
  assert.strictEqual(data.cities[0].name, "Aguaí");
});

test("e o dedupe é GLOBAL: serviço e cidade dividem o namespace de /pagina/<slug>", () => {
  // `/pagina` é o único prefixo que o proxy do front reescreve nos três
  // endereços sem consultar nada, então as duas listas caem na mesma URL.
  // Deduplicando em separado, as duas passariam e quem abre o endereço seria
  // decidido pela ordem de busca do front — sem erro, e diferente do esperado.
  const { data } = normalizeTemplateData("oficina-local", {
    services: [servico({ slug: "instalacao", label: "Instalação" })],
    cities: [{ slug: "instalacao", name: "Cidade que colide" }],
  });
  assert.strictEqual(data.services.length, 1);
  assert.strictEqual(data.cities.length, 0, "a cidade colidente sai; o serviço vem primeiro");
});

test("depoimento sem fonte é descartado — elogio sem origem seria mentira sobre alguém", () => {
  const { data } = normalizeTemplateData("oficina-local", {
    reviews: [
      { quote: "Muito rápido, prestativo e pontual.", source: "Avaliação no Google" },
      { quote: "O melhor da cidade!" },
      { source: "Avaliação no Google" },
    ],
  });
  assert.strictEqual(data.reviews.length, 1);
  assert.strictEqual(data.reviews[0].source, "Avaliação no Google");
});

test("FAQ pela metade é descartada — meia pergunta não é FAQ", () => {
  const { data } = normalizeTemplateData("oficina-local", {
    faq: [{ q: "Atende no sábado?", a: "Não." }, { q: "E no domingo?" }, { a: "Sim." }],
  });
  assert.strictEqual(data.faq.length, 1);
});

test("coordenada pela metade vira null — meia coordenada põe um alfinete no oceano", () => {
  const so = normalizeTemplateData("oficina-local", { business: { geo: { lat: -22.05 } } });
  assert.strictEqual(so.data.business.geo, null);
  const inteira = normalizeTemplateData("oficina-local", {
    business: { geo: { lat: -22.0578, lng: -46.9739 } },
  });
  assert.deepStrictEqual(inteira.data.business.geo, { lat: -22.0578, lng: -46.9739 });
});

test("desenho fora da lista cai no primeiro, nunca no que veio", () => {
  const { data } = normalizeTemplateData("oficina-local", {
    services: [servico({ art: "<script>" })],
  });
  assert.strictEqual(data.services[0].art, "burner");
});

test("o número do WhatsApp fica só com dígitos — ele vira URL de wa.me", () => {
  const { data } = normalizeTemplateData("oficina-local", {
    business: { whatsappNumber: "+55 (19) 99495-7125" },
  });
  assert.strictEqual(data.business.whatsappNumber, "5519994957125");
});

test("documento grande demais é recusado, e a recusa diz o tamanho", () => {
  const gordo = {
    services: Array.from({ length: 24 }, (_, i) =>
      servico({
        slug: `servico-${i}`,
        intro: Array.from({ length: 12 }, () => "x".repeat(2000)),
      })
    ),
  };
  const out = normalizeTemplateData("oficina-local", gordo);
  assert.ok(out.error, "deveria recusar");
  assert.match(out.error, /KB/);
  // E o teto é menor que o do body parser (1mb), então a recusa clara vem
  // ANTES do 413 mudo do express.
  assert.ok(LIMITS.DATA_BYTES < 1024 * 1024);
});

test("entrada torta não derruba — o documento sai vazio e válido", () => {
  for (const lixo of [null, undefined, "texto", 42, [], { services: "não é lista" }]) {
    const { data, error } = normalizeTemplateData("oficina-local", lixo);
    assert.ok(!error, String(lixo));
    assert.deepStrictEqual(data.services, []);
    assert.deepStrictEqual(data.cities, []);
    assert.strictEqual(typeof data.business.name, "string");
  }
});

// ─── A brecha, escrita como asserção ────────────────────────────────────────

/**
 * Só a parte de ESCRITA de um método de storage — o RETURNING lista colunas
 * legitimamente (é ele que devolve a linha inteira para quem chamou), e olhar o
 * SQL todo transformaria "devolve a coluna" em "escreve a coluna". Duas coisas
 * bem diferentes, e é a segunda que abre a brecha.
 */
function parteDeEscrita(fn) {
  return String(fn).split(/RETURNING/i)[0];
}

test("TRAVA 1: o upsert do líder não ESCREVE nenhuma coluna da mig 241", () => {
  // Esta é a porta de escrita do CLIENTE — é ela que o autosave chama a cada
  // pausa. Mencionar `template` aqui deixaria qualquer líder apontar o próprio
  // site para um tema nosso, ou apagar o tema de um site gerenciado gravando
  // seções por cima, sem uma linha de código nova em lugar nenhum.
  const sql = parteDeEscrita(CommunitySiteStorage.upsert);
  for (const coluna of ["template", "template_data", "managed_by_platform", "grace_until"]) {
    assert.ok(
      !sql.includes(coluna),
      `o upsert do líder passou a escrever "${coluna}" — isso abre a brecha do site gerenciado`
    );
  }
  // A mesma disciplina que já vale para o bit de publicação.
  assert.ok(!sql.includes("is_published ="), "salvar não pode publicar");
});

test("TRAVA 2: quem grava as colunas é setManaged, e ele grava as quatro coisas certas", () => {
  const sql = parteDeEscrita(CommunitySiteStorage.setManaged);
  for (const coluna of ["template", "template_data", "managed_by_platform"]) {
    assert.ok(sql.includes(coluna), `setManaged precisa gravar ${coluna}`);
  }
  // E NÃO toca no documento: o rascunho de quem estava no construtor antes de
  // contratar continua guardado, e é o que ele reencontra em `release`.
  for (const coluna of ["sections", "pages", "text_styles"]) {
    assert.ok(!sql.includes(coluna), `setManaged não pode apagar ${coluna} do cliente`);
  }
});

test("TRAVA 3: o predicado de site gerenciado pergunta pelo BIT, não pelo tema", () => {
  // Os dois eixos são independentes de propósito: um site do construtor pode
  // ser travado (montamos e entregamos), e um dia um tema pode ganhar edição
  // de dados. Perguntar por `template != null` fundiria os dois.
  assert.strictEqual(isManaged({ managed_by_platform: true }), true);
  assert.strictEqual(isManaged({ managed_by_platform: true, template: null }), true);
  assert.strictEqual(isManaged({ template: "oficina-local" }), false);
  for (const v of [null, undefined, {}, { managed_by_platform: false }]) {
    assert.strictEqual(isManaged(v), false, JSON.stringify(v));
  }
});

test("a recusa é 403 e diz o que fazer — parede sem saída vira suporte", () => {
  const r = managedRefusal();
  assert.strictEqual(r.statusCode, 403);
  assert.match(r.error, /Freelandoo/);
  assert.ok(r.error.length > 40, "a frase tem que explicar, não só negar");
});

test("a chave do direito está na whitelist e NÃO é vendida na Loja de Funções", () => {
  assert.ok(USER_FEATURE_KEYS.includes("managed_site"));
  // Linha na Loja com is_for_sale = FALSE significa GRÁTIS PARA TODO MUNDO —
  // foi assim que Carteira (216), Academia (217) e Serviços (222) viraram
  // nativas. A chave nasceria liberada para a base inteira, que é o oposto de
  // uma brecha nossa. O seed da mig 241 não cria produto para ela.
  const fs = require("node:fs");
  const mig = fs.readFileSync(
    require("node:path").join(__dirname, "../../src/databases/migrations/241_managed_site.sql"),
    "utf8"
  );
  assert.ok(
    !/INSERT\s+INTO\s+public\.tb_function_product/i.test(mig),
    "a mig 241 não pode criar produto de Loja para managed_site"
  );
});
