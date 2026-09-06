// src/utils/communitySite.js
// FONTE ÚNICA de forma e validação do site da comunidade (mig 212).
//
// O conteúdo mora num JSONB, e JSONB o banco NÃO valida. Então tudo que entra
// passa por `normalizeConfig` antes do UPDATE: kind de seção vem de uma lista
// FECHADA, cor tem que ser hexadecimal de verdade, URL só http(s) (nada de
// `javascript:`), texto tem teto de tamanho e chave desconhecida é DESCARTADA
// em vez de gravada. Normalizar é o contrário de confiar: a saída é montada
// campo a campo a partir da entrada, nunca é a entrada com um remendo.
//
// Ao criar uma seção nova: declarar o kind em SECTION_KINDS e escrever o
// normalizador dela em SECTION_NORMALIZERS. Kind sem normalizador é recusado —
// é isso que impede um payload de inventar uma seção que o front não desenha.

const crypto = require("crypto");

// ─── Tetos ──────────────────────────────────────────────────────────────────
// Existem para que um payload hostil (ou um bug de laço no front) não vire uma
// linha de 10 MB. Cortam em silêncio, sem derrubar o salvamento.
const LIMITS = {
  SECTIONS: 24,
  SLIDES: 8,
  TESTIMONIALS: 24,
  GALLERY: 30,
  HIGHLIGHTS: 8,
  SOCIALS: 6,
  // Blocos da seção de chamada (o "próximo horário" da composição de
  // referência): rótulo curto + valor, lado a lado. Mais do que quatro deixa
  // de ser destaque e vira tabela.
  CTA_ITEMS: 4,
  // Selos da seção de pessoa ("Cuidado", "Atenção", "Qualidade"...).
  TAGS: 8,
  SITE_NAME: 120,
  TAGLINE: 240,
  TITLE: 120,
  SUBTITLE: 240,
  SHORT: 160,
  BODY: 2000,
  URL: 600,
  // Tamanhos escolhidos na mão pelo líder (alças do construtor). O teto de
  // entradas existe pelo mesmo motivo dos outros: um bug de laço no front não
  // pode virar uma linha de 10 MB.
  TEXT_STYLES: 240,
  STYLE_KEY: 96,
};

/**
 * Faixas dos tamanhos manuais. São TETOS DE SANIDADE, não gosto: fonte de
 * 4000px estoura o layout de quem visita, e altura de seção negativa some com
 * o conteúdo sem dizer por quê. Fora da faixa, fixa na borda — nunca recusa o
 * save inteiro.
 */
const SIZES = {
  FONT_MIN: 8,
  FONT_MAX: 200,
  WIDTH_MIN: 10, // % da largura do bloco
  WIDTH_MAX: 100,
  HEIGHT_MIN: 40,
  HEIGHT_MAX: 2400,
  MAXW_MIN: 320,
  MAXW_MAX: 1920,
};

const SECTION_KINDS = [
  "hero",
  "services_catalog",
  "about",
  "testimonials",
  "cta",
  "person",
  "gallery",
  "contact",
];

/**
 * Ícones que um destaque de "Sobre" pode usar.
 *
 * Lista FECHADA pela mesma razão de OBJECT_POSITIONS: o valor vira o NOME de
 * um componente escolhido num mapa do front. String livre ali seria um jeito
 * de pedir um componente que não existe — no melhor caso a seção não desenha,
 * no pior o mapa é indexado com algo que não deveria.
 *
 * Ícone novo: acrescentar aqui E no mapa do front. Ausente dos dois, o
 * normalizador devolve o default e nada quebra.
 */
const ICONS = [
  "none",
  "sparkles",
  "star",
  "heart",
  "shield",
  "clock",
  "users",
  "award",
  "coffee",
  "camera",
  "music",
  "map-pin",
  "wifi",
  "gift",
  "leaf",
  "zap",
  "check",
  "home",
  "smile",
  "thumbs-up",
  "sun",
];

// Paleta padrão = identidade tabloide escura da casa.
const DEFAULT_THEME = {
  primary: "#f2b705",
  background: "#0b0b0d",
  surface: "#15120e",
  textPrimary: "#f5f1e8",
  textSecondary: "#9a938a",
  accent: "#e5a800",
};

const THEME_KEYS = Object.keys(DEFAULT_THEME);

// ─── Primitivas ─────────────────────────────────────────────────────────────

function str(value, max) {
  if (typeof value !== "string") return "";
  // O byte nulo quebra o JSONB do Postgres ("unsupported Unicode escape sequence"):
  // é o único caractere que precisa sumir antes de chegar no banco.
  return value.replace(/\u0000/g, "").trim().slice(0, max);
}

function bool(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

/** #RGB e #RRGGBB, normalizados para #RRGGBB minúsculo. Fora disso, fallback. */
function hex(value, fallback) {
  if (typeof value !== "string") return fallback;
  const raw = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    const r = raw[1];
    const g = raw[2];
    const b = raw[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return fallback;
}

/**
 * URL de destino. Aceita http(s), mailto:, tel: e caminho interno começando
 * com "/". Recusa TODO o resto — `javascript:` e `data:` num href viram XSS no
 * clique, e a seção de contato é justamente onde um link entra.
 */
function link(value) {
  const raw = str(value, LIMITS.URL);
  if (!raw) return "";
  if (raw.startsWith("//")) return "";
  if (raw.startsWith("/")) return raw;
  if (/^(mailto:|tel:)[^\s]+$/i.test(raw)) return raw;
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? raw : "";
  } catch {
    return "";
  }
}

/** URL de imagem: só http(s) ou caminho interno — nunca data:/blob:. */
function imageUrl(value) {
  const raw = str(value, LIMITS.URL);
  if (!raw) return "";
  if (raw.startsWith("//")) return "";
  if (raw.startsWith("/")) return raw;
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? raw : "";
  } catch {
    return "";
  }
}

/**
 * `object-position` do enquadramento. Lista fechada em vez de string livre:
 * o valor vai direto para um style inline, e string livre ali é injeção de CSS.
 */
const OBJECT_POSITIONS = [
  "center",
  "top",
  "bottom",
  "left",
  "right",
  "top left",
  "top right",
  "bottom left",
  "bottom right",
];

function objectPosition(value) {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  return OBJECT_POSITIONS.includes(raw) ? raw : "center";
}

/** Nome de ícone da lista fechada. Fora dela, o default do destaque. */
function icon(value, fallback = "sparkles") {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  return ICONS.includes(raw) ? raw : fallback;
}

/**
 * Data de um depoimento, em ISO curto (`AAAA-MM-DD`).
 *
 * Guardada como data, e não como o texto "15 de fev. de 2026", porque o site é
 * servido em três idiomas: texto gravado no servidor ficaria em português para
 * todo mundo. Quem escreve por extenso é o front, que sabe o idioma de quem lê.
 *
 * Vazio é válido — depoimento sem data é o caso comum.
 */
function isoDate(value) {
  const raw = str(value, 10);
  if (!raw) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
  // Regex sozinha aceita 2026-13-40. `Date` desempata, e a volta a ISO recusa
  // o dia que "transbordou" para o mês seguinte (2026-02-31 vira 2026-03-03).
  const d = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10) === raw ? raw : "";
}

/**
 * Inteiro dentro de uma faixa. `null` significa AUTO — "o líder não escolheu
 * tamanho aqui" — e é diferente de zero: zero seria uma escolha (some da tela).
 * Por isso valor ausente, NaN ou texto voltam null em vez de cair num default
 * numérico, que congelaria o layout responsivo de toda seção nunca tocada.
 */
function num(value, min, max) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function id(value) {
  const raw = str(value, 40);
  // Id vira `key` de React e âncora de DOM: mantemos só o alfabeto seguro.
  const safe = raw.replace(/[^a-zA-Z0-9_-]/g, "");
  return safe || crypto.randomUUID();
}

function list(value, max, fn) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, max).map(fn);
}

/** Nota de depoimento: inteiro de 1 a 5. */
function rating(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 5;
  return Math.min(5, Math.max(1, Math.round(n)));
}

// ─── Normalizadores por seção ───────────────────────────────────────────────

function normalizeSlide(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  return {
    id: id(d.id),
    imageUrl: imageUrl(d.imageUrl),
    objectPosition: objectPosition(d.objectPosition),
    headline: str(d.headline, LIMITS.TITLE),
    subheadline: str(d.subheadline, LIMITS.SUBTITLE),
    ctaText: str(d.ctaText, 40),
    ctaUrl: link(d.ctaUrl),
    // Segundo botão do banner ("Conheça o espaço" na composição de
    // referência). Fica ao lado do primeiro, com peso menor. Sem texto, não
    // é desenhado — não existe botão fantasma.
    ctaSecondaryText: str(d.ctaSecondaryText, 40),
    ctaSecondaryUrl: link(d.ctaSecondaryUrl),
  };
}

function normalizeHighlight(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  return {
    id: id(d.id),
    icon: icon(d.icon),
    title: str(d.title, 60),
    description: str(d.description, LIMITS.SHORT),
  };
}

function normalizeCtaItem(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  return {
    id: id(d.id),
    label: str(d.label, 40),
    value: str(d.value, 60),
  };
}

function normalizeTag(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  return { id: id(d.id), label: str(d.label, 40) };
}

function normalizeTestimonial(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  return {
    id: id(d.id),
    name: str(d.name, 80),
    avatarUrl: imageUrl(d.avatarUrl),
    rating: rating(d.rating),
    text: str(d.text, LIMITS.SHORT * 3),
    role: str(d.role, 80),
    date: isoDate(d.date),
  };
}

function normalizePhoto(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  return {
    id: id(d.id),
    imageUrl: imageUrl(d.imageUrl),
    objectPosition: objectPosition(d.objectPosition),
    caption: str(d.caption, 120),
  };
}

function normalizeSocial(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  return {
    id: id(d.id),
    label: str(d.label, 40),
    url: link(d.url),
  };
}

const SECTION_NORMALIZERS = {
  hero: (d) => ({
    slides: list(d.slides, LIMITS.SLIDES, normalizeSlide),
    autoplay: bool(d.autoplay, true),
    height: ["short", "medium", "tall"].includes(d.height) ? d.height : "tall",
  }),

  // A vitrine de serviços NÃO guarda conteúdo (2026-09-04, decisão do Alex).
  //
  // Ela mostra os serviços REAIS cadastrados na Freelandoo, servidos pelo
  // backend a cada leitura — o que sobra aqui é só a apresentação. Antes eram
  // itens de texto livre (título, descrição e PREÇO digitados à mão no
  // construtor), e isso dava ao site uma segunda verdade sobre preço: bastava o
  // líder reajustar o serviço de verdade e esquecer do site para a página
  // pública seguir anunciando o valor antigo.
  //
  // `items` deixou de ser normalizado de propósito. Pela regra desta fonte,
  // chave desconhecida é DESCARTADA — então o texto livre dos sites que já
  // existem some sozinho no próximo save, sem migration e sem varredura. As
  // chaves de `textStyles` que apontavam para esses itens ficam órfãs e a poda
  // que já existe as recolhe.
  services_catalog: (d) => ({
    columns: [2, 3, 4].includes(Number(d.columns)) ? Number(d.columns) : 3,
  }),

  about: (d) => ({
    body: str(d.body, LIMITS.BODY),
    highlights: list(d.highlights, LIMITS.HIGHLIGHTS, normalizeHighlight),
    photos: list(d.photos, 4, normalizePhoto),
  }),

  testimonials: (d) => ({
    items: list(d.items, LIMITS.TESTIMONIALS, normalizeTestimonial),
  }),

  /**
   * Bloco de chamada: um selo, duas a quatro informações lado a lado e um
   * botão grande. É o "próximo horário disponível" da composição de
   * referência, sem a parte que aqui seria mentira.
   *
   * Os valores são TEXTO escrito pelo líder, e não dado vivo de agenda: o site
   * não consulta disponibilidade, e um bloco que dissesse "hoje às 19:30" a
   * partir de nada anunciaria um horário que ninguém garantiu. Quem tem
   * agenda, sinal e pagamento é o perfil — é para lá que o botão leva.
   */
  cta: (d) => ({
    badge: str(d.badge, 60),
    items: list(d.items, LIMITS.CTA_ITEMS, normalizeCtaItem),
    ctaText: str(d.ctaText, 40),
    ctaUrl: link(d.ctaUrl),
    note: str(d.note, LIMITS.SHORT),
  }),

  /**
   * Quem está por trás: retrato, texto e selos.
   *
   * O cabeçalho (título e subtítulo) NÃO vem daqui — mora na seção, como o de
   * todas as outras. A diferença é só onde ele é desenhado: nesta composição
   * ele fica dentro da coluna de texto, ao lado da foto, e não acima das duas.
   */
  person: (d) => ({
    photoUrl: imageUrl(d.photoUrl),
    objectPosition: objectPosition(d.objectPosition),
    body: str(d.body, LIMITS.BODY),
    tags: list(d.tags, LIMITS.TAGS, normalizeTag),
    ctaText: str(d.ctaText, 40),
    ctaUrl: link(d.ctaUrl),
  }),

  gallery: (d) => ({
    photos: list(d.photos, LIMITS.GALLERY, normalizePhoto),
    columns: [2, 3, 4].includes(Number(d.columns)) ? Number(d.columns) : 3,
  }),

  contact: (d) => ({
    address: str(d.address, LIMITS.SHORT),
    mapsUrl: link(d.mapsUrl),
    whatsapp: str(d.whatsapp, 40),
    email: str(d.email, 120),
    hours: str(d.hours, LIMITS.SHORT * 2),
    socials: list(d.socials, LIMITS.SOCIALS, normalizeSocial),
  }),
};

/**
 * Tamanho da SEÇÃO escolhido nas alças do construtor: altura mínima e largura
 * da coluna de conteúdo. Só isso — nada de posição livre. Uma seção arrastável
 * em (x, y) deixaria de ser responsiva, e o mesmo site precisa caber no celular
 * de quem visita.
 */
function normalizeLayout(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  return {
    minHeight: num(d.minHeight, SIZES.HEIGHT_MIN, SIZES.HEIGHT_MAX),
    maxWidth: num(d.maxWidth, SIZES.MAXW_MIN, SIZES.MAXW_MAX),
  };
}

/**
 * Tamanhos por CAIXA DE TEXTO, num mapa `caminho -> { fontSize, width }`.
 *
 * Mapa à parte, e não um campo dentro de cada texto: os textos do site são
 * strings simples espalhadas por seis formatos de seção, e pendurar estilo em
 * cada uma delas mudaria a forma de TODOS os normalizadores (e do front junto)
 * para guardar dois números. O caminho já identifica a caixa.
 *
 * A chave é sanitizada e as órfãs somem: chave `sec:<id>` de seção que não
 * existe mais é descartada, senão o mapa cresceria para sempre a cada seção
 * removida — e um dia estouraria o teto, derrubando estilo de caixa VIVA.
 */
function normalizeTextStyles(raw, liveSectionIds) {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const out = {};
  let kept = 0;

  for (const [rawKey, rawValue] of Object.entries(input)) {
    if (kept >= LIMITS.TEXT_STYLES) break;
    const key = typeof rawKey === "string" ? rawKey.slice(0, LIMITS.STYLE_KEY) : "";
    // O caminho vira chave de React e seletor de DOM: alfabeto fechado.
    if (!/^[a-zA-Z0-9_.:-]+$/.test(key)) continue;
    if (key.startsWith("sec:")) {
      const sectionId = key.slice(4).split(".")[0];
      if (!liveSectionIds.has(sectionId)) continue;
    }
    const d = rawValue && typeof rawValue === "object" ? rawValue : {};
    const fontSize = num(d.fontSize, SIZES.FONT_MIN, SIZES.FONT_MAX);
    const width = num(d.width, SIZES.WIDTH_MIN, SIZES.WIDTH_MAX);
    // Entrada sem nenhum tamanho é lixo: gravá-la só ocuparia o teto.
    if (fontSize === null && width === null) continue;
    out[key] = { fontSize, width };
    kept += 1;
  }

  return out;
}

function normalizeSection(raw) {
  if (!raw || typeof raw !== "object") return null;
  const kind = typeof raw.kind === "string" ? raw.kind : "";
  const normalizeData = SECTION_NORMALIZERS[kind];
  // Kind fora da lista fechada não vira seção: o front não sabe desenhá-lo, e
  // guardá-lo só criaria uma seção invisível que ressuscita a cada save.
  if (!normalizeData) return null;
  return {
    id: id(raw.id),
    kind,
    enabled: bool(raw.enabled, true),
    title: str(raw.title, LIMITS.TITLE),
    subtitle: str(raw.subtitle, LIMITS.SUBTITLE),
    layout: normalizeLayout(raw.layout),
    data: normalizeData(raw.data && typeof raw.data === "object" ? raw.data : {}),
  };
}

function normalizeTheme(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const out = {};
  for (const key of THEME_KEYS) out[key] = hex(input[key], DEFAULT_THEME[key]);
  return out;
}

/**
 * Normaliza o payload INTEIRO. Devolve sempre um objeto válido — nunca lança:
 * um campo estragado degrada para o default em vez de derrubar o salvamento do
 * site todo (o líder perderia a edição por causa de uma cor digitada errada).
 */
function normalizeConfig(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const sections = Array.isArray(input.sections)
    ? input.sections
        .slice(0, LIMITS.SECTIONS)
        .map(normalizeSection)
        .filter(Boolean)
    : [];

  // Ids repetidos quebram a reordenação e a remoção no construtor (remover uma
  // seção removeria a irmã de mesmo id), então o segundo ganha id novo.
  const seen = new Set();
  for (const section of sections) {
    if (seen.has(section.id)) section.id = crypto.randomUUID();
    seen.add(section.id);
  }

  // Depois do desempate, não antes: a seção que trocou de id perdeu a
  // identidade, e os tamanhos que apontavam para o id velho não são dela.
  const liveSectionIds = new Set(sections.map((s) => s.id));

  return {
    siteName: str(input.siteName, LIMITS.SITE_NAME),
    tagline: str(input.tagline, LIMITS.TAGLINE),
    theme: normalizeTheme(input.theme),
    textStyles: normalizeTextStyles(input.textStyles, liveSectionIds),
    sections,
  };
}

// ─── Template inicial ───────────────────────────────────────────────────────

/**
 * O site que o líder vê ao abrir o construtor pela primeira vez. Nasce com o
 * que a comunidade JÁ tem — nome, bio, capa — porque uma tela em branco não
 * ensina o que dá para fazer ali; um site pré-montado e editável ensina.
 *
 * Não é persistido: só vira linha quando o líder salva. Enquanto isso, GET
 * devolve este template com `exists: false`.
 */
function buildDefaultConfig(community) {
  const c = community && typeof community === "object" ? community : {};
  const name = str(c.display_name, LIMITS.SITE_NAME) || "Minha comunidade";
  const bio = str(c.bio, LIMITS.BODY);
  const banner = imageUrl(c.banner_url);
  const avatar = imageUrl(c.avatar_url);

  return normalizeConfig({
    siteName: name,
    tagline: str(c.enxame_name, LIMITS.TAGLINE),
    theme: DEFAULT_THEME,
    sections: [
      {
        id: crypto.randomUUID(),
        kind: "hero",
        enabled: true,
        title: "",
        subtitle: "",
        data: {
          height: "tall",
          autoplay: true,
          slides: [
            {
              id: crypto.randomUUID(),
              imageUrl: banner,
              objectPosition: "center",
              headline: name,
              subheadline:
                bio.slice(0, LIMITS.SUBTITLE) || "Bem-vindo ao nosso espaço.",
              ctaText: "Fale com a gente",
              ctaUrl: "",
              // O segundo botão nasce sem link de propósito: o front o aponta
              // para a seção seguinte enquanto o líder não escolher um destino.
              ctaSecondaryText: "Conheça o espaço",
              ctaSecondaryUrl: "",
            },
          ],
        },
      },
      {
        id: crypto.randomUUID(),
        kind: "about",
        enabled: true,
        title: "Aqui você não é só mais um.",
        subtitle: "",
        data: {
          body:
            bio ||
            "Conte a história da comunidade: como começou, quem faz parte e o que vocês fazem juntos.",
          highlights: [
            {
              id: crypto.randomUUID(),
              icon: "heart",
              title: "Nosso jeito",
              description: "O que torna esta comunidade diferente.",
            },
            {
              id: crypto.randomUUID(),
              icon: "users",
              title: "Para quem é",
              description: "Quem se sente em casa aqui.",
            },
            {
              id: crypto.randomUUID(),
              icon: "clock",
              title: "Quando acontece",
              description: "Os dias e horários em que vocês se encontram.",
            },
            {
              id: crypto.randomUUID(),
              icon: "map-pin",
              title: "Onde é",
              description: "O lugar onde tudo acontece.",
            },
          ],
          photos: avatar
            ? [{ id: crypto.randomUUID(), imageUrl: avatar, objectPosition: "center", caption: "" }]
            : [],
        },
      },
      {
        id: crypto.randomUUID(),
        kind: "services_catalog",
        enabled: true,
        title: "O que oferecemos",
        subtitle: "Serviços e produtos da comunidade.",
        // Sem itens de exemplo: o conteúdo desta seção são os serviços
        // cadastrados na Freelandoo, buscados a cada leitura. Semear texto
        // falso aqui daria ao líder três "serviços" que ele não vende e que
        // sumiriam sozinhos no primeiro carregamento.
        data: { columns: 3 },
      },
      {
        id: crypto.randomUUID(),
        kind: "testimonials",
        enabled: true,
        title: "O que dizem sobre a experiência",
        subtitle: "Quem já passou por aqui conta como foi.",
        // Sem depoimento de exemplo: elogio inventado publicado como se fosse
        // de um cliente é o único conteúdo semeado que seria uma mentira sobre
        // outra pessoa. A seção nasce vazia e some em leitura até ter o
        // primeiro depoimento de verdade.
        data: { items: [] },
      },
      {
        id: crypto.randomUUID(),
        kind: "cta",
        enabled: true,
        title: "Vamos combinar",
        subtitle: "",
        data: {
          badge: "Atendimento com hora marcada",
          items: [
            { id: crypto.randomUUID(), label: "Dias", value: "Seg a sáb" },
            { id: crypto.randomUUID(), label: "Horário", value: "09h às 20h" },
            { id: crypto.randomUUID(), label: "Onde", value: "Combine pelo WhatsApp" },
          ],
          ctaText: "Falar agora",
          ctaUrl: "",
          note: "",
        },
      },
      {
        id: crypto.randomUUID(),
        kind: "person",
        enabled: true,
        title: "Quem está por trás",
        subtitle: "",
        data: {
          photoUrl: avatar,
          objectPosition: "center",
          body:
            "Apresente quem conduz a comunidade: o que faz, há quanto tempo e por que faz.",
          tags: [
            { id: crypto.randomUUID(), label: "Cuidado" },
            { id: crypto.randomUUID(), label: "Atenção" },
            { id: crypto.randomUUID(), label: "Qualidade" },
            { id: crypto.randomUUID(), label: "Pontualidade" },
          ],
          ctaText: "",
          ctaUrl: "",
        },
      },
      {
        id: crypto.randomUUID(),
        kind: "contact",
        enabled: true,
        title: "Passa aqui. A casa é sua.",
        subtitle: "",
        data: {},
      },
    ],
  });
}

/** Seção nova em branco, pedida pelo menu "adicionar seção" do construtor. */
function buildEmptySection(kind) {
  if (!SECTION_NORMALIZERS[kind]) return null;
  return normalizeSection({
    id: crypto.randomUUID(),
    kind,
    enabled: true,
    title: "",
    subtitle: "",
    data: {},
  });
}

module.exports = {
  LIMITS,
  SIZES,
  SECTION_KINDS,
  DEFAULT_THEME,
  OBJECT_POSITIONS,
  ICONS,
  normalizeConfig,
  normalizeSection,
  normalizeTheme,
  normalizeTextStyles,
  buildDefaultConfig,
  buildEmptySection,
};
