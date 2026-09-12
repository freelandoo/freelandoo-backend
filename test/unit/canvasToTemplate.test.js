// Conversão do site do CONSTRUTOR para o documento de um TEMA.
//
// *unit* de propósito: `deriveTemplateData` é função pura sobre o documento —
// não precisa de Postgres, e as deduções que ela faz são exatamente o tipo de
// coisa que se confere com entrada e saída.
//
// ⚠️ O QUE ESTES CASOS PROTEGEM são as três deduções que podem errar em
// silêncio: quem é cidade e quem é serviço, o telefone que a pessoa vai ligar,
// e o endereço repartido. Nas três, errar produz uma página CORRETA na tela
// dizendo a coisa errada — que é o modo de falhar mais caro que existe aqui.

const test = require("node:test");
const assert = require("node:assert");

const {
  deriveTemplateData,
  deriveOficinaLocal,
  splitAddress,
  splitHours,
  splitBullets,
  displayFromDigits,
  messageFromWaUrl,
} = require("../../src/utils/canvasToTemplate");

// ─── helpers de documento ────────────────────────────────────────────────────
const hero = (d = {}) => ({
  kind: "hero",
  title: "",
  data: { slides: [{ headline: "H1", subheadline: "Sub", ctaUrl: "", ...d }] },
});
const about = (title, body, highlights = []) => ({
  kind: "about",
  title,
  data: { body, highlights },
});
const faq = (items) => ({
  kind: "faq",
  title: "Perguntas",
  data: { items: items.map((i) => ({ question: i[0], answer: i[1] })) },
});
const areas = (items) => ({
  kind: "areas",
  title: "Onde",
  data: { items },
});
const cta = (slug) => ({ kind: "cta", title: "Veja também", data: { ctaUrl: `pagina:${slug}` } });

const COMUNIDADE = { display_name: "Comunidade" };

// ─── o telefone ──────────────────────────────────────────────────────────────

test("telefone: formato brasileiro de celular vira o que se lê", () => {
  assert.strictEqual(displayFromDigits("5519994957125"), "(19) 99495-7125");
  assert.strictEqual(displayFromDigits("+55 (19) 99495-7125"), "(19) 99495-7125");
});

test("telefone fora do formato devolve VAZIO — número errado é pior que nenhum, porque a pessoa liga", () => {
  assert.strictEqual(displayFromDigits("551999495712"), "", "faltando um dígito");
  assert.strictEqual(displayFromDigits("13234567890"), "", "outro país");
  assert.strictEqual(displayFromDigits(""), "");
  assert.strictEqual(displayFromDigits(null), "");
});

// ─── o endereço ──────────────────────────────────────────────────────────────

test("endereço no formato do construtor vira quatro campos", () => {
  assert.deepStrictEqual(
    splitAddress("Rua Teófilo Fontes Rodrigues — Aguaí/SP — CEP 13860-000"),
    {
      street: "Rua Teófilo Fontes Rodrigues",
      city: "Aguaí",
      state: "SP",
      postalCode: "13860-000",
    }
  );
});

test("endereço fora do formato devolve null — e a conversão o mantém INTEIRO na rua", () => {
  assert.strictEqual(splitAddress("Perto da praça, do lado do mercado"), null);

  const { data, warnings } = deriveOficinaLocal(
    {
      sections: [{ kind: "contact", data: { address: "Perto da praça" } }],
    },
    COMUNIDADE
  );
  // ⚠️ Repartir errado poria "Perto da praça" num campo que diz CIDADE, e a
  // ficha do Google passaria a declarar uma cidade que não existe.
  assert.strictEqual(data.business.street, "Perto da praça");
  assert.strictEqual(data.business.city, "");
  assert.strictEqual(data.business.state, "");
  assert.ok(warnings.some((w) => w.code === "endereco_formato"));
});

// ─── o horário ───────────────────────────────────────────────────────────────

test("horário parte na primeira frase: quando abre e quando não abre", () => {
  assert.deepStrictEqual(splitHours("Segunda a sexta, 08h às 18h. Sábado e domingo: fechado."), {
    hoursHuman: "Segunda a sexta, 08h às 18h. Sábado e domingo: fechado.",
    hoursShort: "Segunda a sexta, 08h às 18h",
    closedHuman: "Sábado e domingo: fechado",
  });
});

test("horário sem ponto não é partido — o tema omite a linha em vez de inventar", () => {
  const out = splitHours("Todos os dias, de manhã até o fim da tarde, mediante agendamento prévio");
  assert.strictEqual(out.hoursShort, "", "longo demais para a linha curta");
  assert.strictEqual(out.closedHuman, "");
});

// ─── os marcadores ───────────────────────────────────────────────────────────

test("marcadores viram itens e o texto antes deles vira a linha de apoio", () => {
  const out = splitBullets("Chame quando:\n• A chama está amarela\n• O forno não aquece");
  assert.strictEqual(out.lead, "Chame quando:");
  assert.deepStrictEqual(out.items, ["A chama está amarela", "O forno não aquece"]);
});

test("texto DEPOIS dos marcadores é descartado — no lead ele apareceria ANTES da lista que comentava", () => {
  const out = splitBullets("Antes\n• Um\n• Dois\nDepois");
  assert.strictEqual(out.lead, "Antes");
  assert.deepStrictEqual(out.items, ["Um", "Dois"]);
});

// ─── a mensagem do WhatsApp ──────────────────────────────────────────────────

test("a mensagem sai do ?text= do link do banner", () => {
  assert.strictEqual(
    messageFromWaUrl("https://wa.me/5519994957125?text=Ol%C3%A1%20Ricardo"),
    "Olá Ricardo"
  );
  assert.strictEqual(messageFromWaUrl("https://wa.me/5519994957125"), "");
  assert.strictEqual(messageFromWaUrl(""), "");
});

// ─── quem é cidade e quem é serviço ──────────────────────────────────────────

test("a seção de ÁREAS é quem diz quem é cidade — não o nome da página", () => {
  const site = {
    site_name: "Negócio",
    sections: [areas([{ url: "pagina:casa-branca", name: "Casa Branca", uf: "SP" }])],
    pages: [
      { slug: "casa-branca", title: "Casa Branca", enabled: true, sections: [hero()] },
      // ⚠️ O caso que a regra existe para resolver: um SERVIÇO com nome de
      // cidade. Decidindo por "parece nome de cidade", ele viraria uma página
      // de cidade e o site anunciaria atendimento numa cidade inventada.
      { slug: "portas-de-casa-branca", title: "Portas Casa Branca", enabled: true, sections: [hero()] },
    ],
  };
  const { data } = deriveOficinaLocal(site, COMUNIDADE);
  assert.deepStrictEqual(data.cities.map((c) => c.slug), ["casa-branca"]);
  assert.deepStrictEqual(data.services.map((s) => s.slug), ["portas-de-casa-branca"]);
});

test("sem seção de áreas, nenhuma página vira cidade — e a conversão AVISA", () => {
  const { data, warnings } = deriveOficinaLocal(
    { pages: [{ slug: "aguai", title: "Aguaí", enabled: true, sections: [hero()] }] },
    COMUNIDADE
  );
  assert.strictEqual(data.cities.length, 0);
  assert.strictEqual(data.services.length, 1);
  assert.ok(warnings.some((w) => w.code === "sem_areas"));
});

test("a cidade-sede sai do ENDEREÇO do negócio, não da ordem da lista", () => {
  const site = {
    sections: [
      { kind: "contact", data: { address: "Rua X — Mogi Guaçu/SP — CEP 13840-000" } },
      areas([
        { url: "pagina:aguai", name: "Aguaí", uf: "SP" },
        { url: "pagina:mogi-guacu", name: "Mogi Guaçu", uf: "SP" },
      ]),
    ],
    pages: [
      { slug: "aguai", title: "Aguaí", enabled: true, sections: [hero()] },
      { slug: "mogi-guacu", title: "Mogi Guaçu", enabled: true, sections: [hero()] },
    ],
  };
  const { data } = deriveOficinaLocal(site, COMUNIDADE);
  // A primeira da lista é Aguaí; a sede é Mogi Guaçu, que é onde o negócio fica.
  assert.strictEqual(data.cities.find((c) => c.slug === "aguai").isBase, false);
  assert.strictEqual(data.cities.find((c) => c.slug === "mogi-guacu").isBase, true);
});

// ─── a ordem dos blocos ──────────────────────────────────────────────────────

test("os três blocos do serviço entram em ordem: problema, o que cobre, quando chamar", () => {
  const site = {
    pages: [
      {
        slug: "reforma",
        title: "Reforma",
        enabled: true,
        subtitle: "Descrição para busca",
        sections: [
          hero({ headline: "Reforma completa", ctaUrl: "https://wa.me/55?text=Quero%20reforma" }),
          about("O problema", "Primeiro.\n\nSegundo."),
          about("O que entra", "Escopo.", [{ title: "Peças", description: "Grelhas" }]),
          about("Quando faz sentido", "Chame quando:\n• Estrutura firme\n• Peças no fim"),
          faq([["P?", "R."]]),
          cta("conserto"),
        ],
      },
    ],
  };
  const { data } = deriveOficinaLocal(site, COMUNIDADE);
  const s = data.services[0];
  assert.strictEqual(s.h1, "Reforma completa");
  assert.strictEqual(s.metaDescription, "Descrição para busca");
  assert.strictEqual(s.waMessage, "Quero reforma");
  assert.strictEqual(s.problem.title, "O problema");
  assert.deepStrictEqual(s.problem.body, ["Primeiro.", "Segundo."]);
  assert.strictEqual(s.covers.title, "O que entra");
  assert.deepStrictEqual(s.covers.items, [{ title: "Peças", text: "Grelhas" }]);
  assert.strictEqual(s.signs.lead, "Chame quando:");
  assert.deepStrictEqual(s.signs.items, ["Estrutura firme", "Peças no fim"]);
  assert.deepStrictEqual(s.faq, [{ q: "P?", a: "R." }]);
  assert.deepStrictEqual(s.related, ["conserto"]);
});

test("número de blocos diferente de três AVISA — a ordem pode ter caído trocada", () => {
  const { warnings } = deriveOficinaLocal(
    {
      pages: [
        {
          slug: "x",
          title: "X",
          enabled: true,
          sections: [hero(), about("Um", "a"), about("Dois", "b")],
        },
      ],
    },
    COMUNIDADE
  );
  assert.ok(warnings.some((w) => w.code === "servico_blocos"));
});

// ─── o que NÃO é inventado ───────────────────────────────────────────────────

test("o nome da pessoa NÃO é deduzido do nome do negócio", () => {
  // "Ricardo Fogões" → "Ricardo" acertaria aqui e escreveria "Padaria" na
  // próxima — e o tema usa isso em "Fale com {owner}".
  const { data } = deriveOficinaLocal({ site_name: "Ricardo Fogões" }, COMUNIDADE);
  assert.strictEqual(data.business.owner, "");
});

test("documento vazio não quebra e não inventa nada", () => {
  const { data } = deriveOficinaLocal({}, COMUNIDADE);
  assert.strictEqual(data.business.name, "Comunidade", "cai no nome da comunidade");
  assert.deepStrictEqual(data.services, []);
  assert.deepStrictEqual(data.cities, []);
  assert.deepStrictEqual(data.reviews, []);
  assert.strictEqual(data.business.geo, null);
});

test("depoimento sem nome não entra — elogio sem origem seria mentira sobre alguém", () => {
  const { data } = deriveOficinaLocal(
    {
      sections: [
        {
          kind: "testimonials",
          data: { items: [{ text: "Muito bom", name: "" }, { text: "Ótimo", name: "Cliente" }] },
        },
      ],
    },
    COMUNIDADE
  );
  assert.deepStrictEqual(data.reviews, [{ quote: "Ótimo", source: "Cliente" }]);
});

// ─── a página desligada ──────────────────────────────────────────────────────

test("página DESLIGADA no construtor avisa — no tema não existe desligar", () => {
  const { data, warnings } = deriveOficinaLocal(
    { pages: [{ slug: "aguai", title: "Aguaí", enabled: false, sections: [hero()] }] },
    COMUNIDADE
  );
  assert.strictEqual(data.services.length, 1, "ela entra mesmo assim");
  const w = warnings.find((x) => x.code === "pagina_desligada");
  assert.ok(w && w.detail.includes("Aguaí"));
});

// ─── o tema sem conversor ────────────────────────────────────────────────────

test("tema que não sabe ler o construtor devolve documento vazio e diz isso", () => {
  const { data, warnings } = deriveTemplateData("tema-que-nao-existe", {}, COMUNIDADE);
  assert.deepStrictEqual(data, {});
  assert.ok(warnings.some((w) => w.code === "sem_conversor"));
});
