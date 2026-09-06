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
  SECTION_KINDS,
  ICONS,
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
