// test/unit/communitySite.test.js
// Campos e seções que a composição do site da comunidade ganhou (2026-09-06):
// CTA secundário do banner, ícone de destaque, data de depoimento e as seções
// `cta` (bloco de chamada) e `person` (quem está por trás).
//
// Mora em test/unit porque `normalizeConfig` é função PURA: não precisa de
// Postgres e por isso roda em qualquer máquina, inclusive quando a suíte e2e
// (`npm run test:community-site`) está bloqueada por falta de banco local.
const test = require("node:test");
const assert = require("node:assert");

const {
  LIMITS,
  SECTION_KINDS,
  ICONS,
  SIZES,
  normalizeSection,
  normalizeConfig,
  buildDefaultConfig,
  buildEmptySection,
} = require("../../src/utils/communitySite");

/** Atalho: normaliza uma seção só e devolve os dados dela. */
function data(kind, raw) {
  const section = normalizeSection({ id: "s1", kind, data: raw });
  assert.ok(section, `kind ${kind} foi recusado`);
  return section.data;
}

test("as duas seções novas estão na lista fechada e nascem em branco", () => {
  assert.ok(SECTION_KINDS.includes("cta"));
  assert.ok(SECTION_KINDS.includes("person"));
  // Kind sem normalizador é recusado — é o que impede um payload de inventar
  // uma seção que o front não desenha.
  assert.strictEqual(buildEmptySection("bloco_inventado"), null);
  assert.strictEqual(buildEmptySection("cta").kind, "cta");
  assert.strictEqual(buildEmptySection("person").kind, "person");
});

test("banner: o segundo botão existe e passa pela MESMA trava de link do primeiro", () => {
  const d = data("hero", {
    slides: [
      {
        id: "a",
        ctaText: "Falar",
        ctaUrl: "https://ok.com",
        ctaSecondaryText: "Conheça",
        ctaSecondaryUrl: "javascript:alert(1)",
      },
    ],
  });
  assert.strictEqual(d.slides[0].ctaSecondaryText, "Conheça");
  // Um href com `javascript:` é XSS no clique. O botão novo não pode ser a
  // porta que o primeiro fechou.
  assert.strictEqual(d.slides[0].ctaSecondaryUrl, "");

  const ok = data("hero", {
    slides: [{ id: "a", ctaSecondaryUrl: "https://exemplo.com/x" }],
  });
  assert.strictEqual(ok.slides[0].ctaSecondaryUrl, "https://exemplo.com/x");
});

test("destaque: ícone vem da lista fechada e nome inventado cai no default", () => {
  const d = data("about", {
    highlights: [
      { id: "a", icon: "heart", title: "T" },
      { id: "b", icon: "MinhaFuncaoMaligna", title: "T" },
      { id: "c", title: "T" },
      { id: "d", icon: "none", title: "T" },
    ],
  });
  assert.deepStrictEqual(
    d.highlights.map((h) => h.icon),
    ["heart", "sparkles", "sparkles", "none"]
  );
  // O valor vira o NOME de um componente escolhido num mapa do front: tudo que
  // sai daqui tem que estar declarado.
  for (const h of d.highlights) assert.ok(ICONS.includes(h.icon));
});

test("depoimento: data é ISO de verdade — texto e dia que não existe viram vazio", () => {
  const d = data("testimonials", {
    items: [
      { id: "a", date: "2026-02-15" },
      { id: "b", date: "2026-02-31" }, // 31 de fevereiro não existe
      { id: "c", date: "15/02/2026" }, // formato do locale, não ISO
      { id: "d", date: "" },
      { id: "e" },
    ],
  });
  assert.deepStrictEqual(
    d.items.map((i) => i.date),
    ["2026-02-15", "", "", "", ""]
  );
});

test("bloco de chamada: teto de 4 informações e link travado", () => {
  const d = data("cta", {
    badge: "Selo",
    items: Array.from({ length: 9 }, (_, i) => ({ id: `i${i}`, label: "L", value: "V" })),
    ctaText: "Ir",
    ctaUrl: "data:text/html,<script>",
    note: "nota",
  });
  assert.strictEqual(d.items.length, 4);
  assert.strictEqual(d.ctaUrl, "");
  assert.strictEqual(d.badge, "Selo");
});

test("quem está por trás: foto só http(s) e teto de selos", () => {
  const d = data("person", {
    photoUrl: "data:image/png;base64,AAAA",
    objectPosition: "top; background:url(x)",
    body: "texto",
    tags: Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, label: "x" })),
  });
  assert.strictEqual(d.photoUrl, "");
  // O enquadramento vai para um style inline: string livre ali é injeção de CSS.
  assert.strictEqual(d.objectPosition, "center");
  assert.strictEqual(d.tags.length, 8);
});

test("chave desconhecida continua sendo descartada nas seções novas", () => {
  const section = normalizeSection({
    id: "s1",
    kind: "cta",
    data: { badge: "ok", scriptMalicioso: "<script>", items: [] },
  });
  assert.ok(!("scriptMalicioso" in section.data));
});

test("o site semeado traz a composição inteira e sobrevive a uma segunda normalização", () => {
  const config = buildDefaultConfig({
    display_name: "Padaria Doze",
    bio: "Pão quente desde 1998.",
    banner_url: "https://cdn.exemplo/b.jpg",
    avatar_url: "https://cdn.exemplo/a.jpg",
    enxame_name: "Alimentação",
  });
  assert.deepStrictEqual(
    config.sections.map((s) => s.kind),
    ["hero", "about", "services_catalog", "testimonials", "cta", "person", "contact"]
  );
  // Depoimento semeado seria elogio inventado publicado como fala de outra
  // pessoa — a única semente que seria uma mentira sobre alguém.
  assert.strictEqual(config.sections.find((s) => s.kind === "testimonials").data.items.length, 0);
  // Normalizar o que já saiu normalizado não pode mudar nada: se mudasse, o
  // primeiro save do líder alteraria o site sem ele ter tocado em nada.
  assert.deepStrictEqual(normalizeConfig(config), config);
});

test("o token `agendar` é o único destino relativo sem barra que passa", () => {
  const d = data("hero", {
    slides: [
      { id: "s1", headline: "x", ctaText: "Agendar", ctaUrl: "agendar" },
      { id: "s2", headline: "y", ctaText: "Não", ctaUrl: "agendartudo" },
      { id: "s3", headline: "z", ctaText: "Nem", ctaUrl: "javascript:alert(1)" },
    ],
  });
  // Token: o front resolve para /c/<slug>/agendar, sub.freelandoo/agendar ou
  // dominio-proprio/agendar conforme por onde o site está sendo servido.
  assert.strictEqual(d.slides[0].ctaUrl, "agendar");
  // Qualquer outra palavra solta continua sendo recusada — senão "agendartudo"
  // viraria href relativo e quebraria em dois dos três endereços.
  assert.strictEqual(d.slides[1].ctaUrl, "");
  assert.strictEqual(d.slides[2].ctaUrl, "");
});

test("o site semeado já abre com o botão de agendar na hero e na chamada", () => {
  const config = buildDefaultConfig({ display_name: "Barbearia Doze" });
  const hero = config.sections.find((s) => s.kind === "hero");
  const cta = config.sections.find((s) => s.kind === "cta");
  assert.strictEqual(hero.data.slides[0].ctaUrl, "agendar");
  assert.strictEqual(cta.data.ctaUrl, "agendar");
});


// ─── Posição da caixa de texto (2026-09-10) ───────────────────────────────────
// A caixa passou a poder ser ARRASTADA dentro do bloco dela, e o deslocamento
// viaja no mesmo mapa do tamanho.

/** Atalho: normaliza um mapa de estilos e devolve a entrada pedida. */
function style(raw, key = "sec:s1.title") {
  const out = normalizeConfig({
    sections: [{ id: "s1", kind: "about", data: {} }],
    textStyles: { [key]: raw },
  });
  return out.textStyles[key];
}

test("posição entra no mapa junto do tamanho e sobrevive a uma segunda normalização", () => {
  const first = style({ fontSize: 40, width: 60, x: 12, y: -80 });
  assert.deepStrictEqual(first, { fontSize: 40, width: 60, x: 12, y: -80 });
  // Idempotência: gravar de volta o que saiu não pode mudar nada.
  assert.deepStrictEqual(style(first), first);
});

test("caixa só deslocada é guardada — posição sem tamanho NÃO é entrada vazia", () => {
  assert.deepStrictEqual(style({ x: 20 }), {
    fontSize: null,
    width: null,
    x: 20,
    y: null,
  });
});

test("zero é escolha do líder (de volta ao lugar) e não ausência", () => {
  // A armadilha: `if (!x)` descartaria o 0 e a caixa voltaria para o
  // deslocamento antigo no próximo carregamento.
  assert.deepStrictEqual(style({ x: 0, y: 0 }), {
    fontSize: null,
    width: null,
    x: 0,
    y: 0,
  });
});

test("caixa sem tamanho e sem posição continua sendo descartada", () => {
  const out = normalizeConfig({
    sections: [{ id: "s1", kind: "about", data: {} }],
    textStyles: { "sec:s1.title": { fontSize: null, width: null, x: null, y: null } },
  });
  assert.strictEqual(out.textStyles["sec:s1.title"], undefined);
});

test("deslocamento fora da faixa fixa na borda, nos dois sentidos, sem recusar o save", () => {
  assert.strictEqual(style({ x: 9000 }).x, SIZES.X_MAX);
  assert.strictEqual(style({ x: -9000 }).x, SIZES.X_MIN);
  assert.strictEqual(style({ y: 99999 }).y, SIZES.Y_MAX);
  assert.strictEqual(style({ y: -99999 }).y, SIZES.Y_MIN);
});

test("deslocamento torto vira AUTO em vez de derrubar a entrada inteira", () => {
  // `Number("esquerda")` é NaN e `Number(undefined)` idem — nenhum dos dois
  // pode virar 0 e fingir que o líder pediu a caixa de volta ao lugar.
  const out = style({ fontSize: 24, x: "esquerda", y: undefined });
  assert.deepStrictEqual(out, { fontSize: 24, width: null, x: null, y: null });
});

test("a seção continua SEM posição — deslocar uma abriria buraco no empilhamento", () => {
  const section = normalizeSection({
    id: "s1",
    kind: "about",
    layout: { minHeight: 300, maxWidth: 900, x: 50, y: 50 },
    data: {},
  });
  assert.deepStrictEqual(section.layout, { minHeight: 300, maxWidth: 900, padY: null });
});

/** Atalho: normaliza uma seção e devolve o layout dela. */
function layout(raw) {
  return normalizeSection({ id: "s1", kind: "about", layout: raw, data: {} }).layout;
}

test("o respiro vertical da seção é guardado e ZERO é escolha, não ausência", () => {
  // É o 0 que deixa a seção encostar no conteúdo quando o líder aperta a linha
  // divisória até o fim; lido como ausência, o respiro voltaria sozinho.
  assert.strictEqual(layout({ padY: 0 }).padY, 0);
  assert.strictEqual(layout({ padY: 40 }).padY, 40);
});

test("seção nunca apertada continua em AUTO — o respiro é o do CSS", () => {
  assert.strictEqual(layout({ minHeight: 300 }).padY, null);
  assert.strictEqual(layout({ padY: "muito" }).padY, null);
});

test("respiro fora da faixa fixa na borda, sem recusar o save", () => {
  assert.strictEqual(layout({ padY: -50 }).padY, SIZES.PADY_MIN);
  assert.strictEqual(layout({ padY: 9000 }).padY, SIZES.PADY_MAX);
});

// ─── Sub-páginas e as seções `faq` / `areas` (E1, 2026-09-11) ───────────────
//
// O site do construtor era de uma página só. Estas asserções travam o modelo
// novo — e, principalmente, o caso que quebraria em silêncio: a poda de
// `textStyles` apagando o tamanho de texto das seções que vivem fora da home.

test("faq e areas entraram na lista fechada e nascem vazias", () => {
  assert.ok(SECTION_KINDS.includes("faq"));
  assert.ok(SECTION_KINDS.includes("areas"));
  assert.deepStrictEqual(data("faq", {}), { items: [] });
  assert.deepStrictEqual(data("areas", {}), { items: [], columns: 3, note: "" });
});

test("faq guarda pergunta e resposta, com teto de itens", () => {
  const d = data("faq", {
    items: Array.from({ length: 40 }, (_, i) => ({ question: `P${i}`, answer: "R" })),
  });
  assert.strictEqual(d.items.length, LIMITS.FAQ_ITEMS);
  assert.strictEqual(d.items[0].question, "P0");
  assert.strictEqual(d.items[0].answer, "R");
  assert.ok(d.items[0].id, "item sem id quebraria a reordenação");
});

test("areas aceita cidade com destino, e recusa destino hostil", () => {
  const d = data("areas", {
    columns: 2,
    items: [
      { name: "Aguaí", uf: "SP", note: "Atendimento no mesmo dia", url: "pagina:aguai" },
      { name: "Mogi Guaçu", uf: "SP", url: "javascript:alert(1)" },
    ],
  });
  assert.strictEqual(d.columns, 2);
  assert.strictEqual(d.items[0].url, "pagina:aguai");
  assert.strictEqual(d.items[1].url, "", "javascript: num href é XSS no clique");
});

test("o link de sub-página é TOKEN, e o slug dele é validado", () => {
  const ok = data("cta", { ctaUrl: "pagina:conserto-de-fogoes" });
  assert.strictEqual(ok.ctaUrl, "pagina:conserto-de-fogoes");
  // maiúscula, acento e barra não são endereço de página
  for (const torto of ["pagina:Conserto", "pagina:aguaí", "pagina:a/b", "pagina:"]) {
    assert.strictEqual(data("cta", { ctaUrl: torto }).ctaUrl, "", `aceitou ${torto}`);
  }
});

test("documento antigo (sem `pages`) continua valendo e ganha lista vazia", () => {
  const c = normalizeConfig({ sections: [{ id: "a", kind: "about", data: { body: "oi" } }] });
  assert.deepStrictEqual(c.pages, []);
  assert.strictEqual(c.sections.length, 1, "a home não pode ser afetada");
});

test("página sem endereço válido é descartada, como kind fora da lista", () => {
  const c = normalizeConfig({
    pages: [
      { slug: "servicos", title: "Serviços" },
      { slug: "COM MAIÚSCULA" },
      { slug: "com/barra" },
      { slug: "agendar" }, // reservado: já é a página de agendamento
      {},
    ],
  });
  assert.strictEqual(c.pages.length, 1);
  assert.strictEqual(c.pages[0].slug, "servicos");
});

test("endereço repetido não gera duas páginas na mesma URL", () => {
  const c = normalizeConfig({
    pages: [
      { slug: "aguai", title: "Primeira" },
      { slug: "aguai", title: "Segunda" },
    ],
  });
  assert.strictEqual(c.pages.length, 1);
  assert.strictEqual(c.pages[0].title, "Primeira");
});

test("id de seção repetido entre a home e uma sub-página é desempatado", () => {
  const c = normalizeConfig({
    sections: [{ id: "mesmo", kind: "about", data: {} }],
    pages: [{ slug: "p", sections: [{ id: "mesmo", kind: "faq", data: {} }] }],
  });
  assert.notStrictEqual(
    c.sections[0].id,
    c.pages[0].sections[0].id,
    "ids iguais fariam as duas dividirem a mesma entrada de textStyles",
  );
});

test("o tamanho de texto de uma seção de SUB-PÁGINA sobrevive ao save", () => {
  // Este é o caso que quebraria calado: a poda de textStyles só conhecia as
  // seções da home, então tudo que o líder dimensionasse fora dela sumiria no
  // salvamento seguinte, sem erro nenhum.
  const c = normalizeConfig({
    sections: [{ id: "home1", kind: "about", data: {} }],
    pages: [{ slug: "servicos", sections: [{ id: "sub1", kind: "faq", data: {} }] }],
    textStyles: {
      "sec:home1.title": { fontSize: 40 },
      "sec:sub1.title": { fontSize: 32 },
      "sec:fantasma.title": { fontSize: 20 },
    },
  });
  assert.ok(c.textStyles["sec:home1.title"], "a home regrediu");
  assert.ok(c.textStyles["sec:sub1.title"], "o tamanho da sub-página foi podado");
  assert.ok(!c.textStyles["sec:fantasma.title"], "seção morta não pode sobreviver");
});

test("o teto de páginas vale", () => {
  const c = normalizeConfig({
    pages: Array.from({ length: 40 }, (_, i) => ({ slug: `p-${i}` })),
  });
  assert.strictEqual(c.pages.length, LIMITS.PAGES);
});
