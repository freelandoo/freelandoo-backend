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
  SERVICES: 48,
  TESTIMONIALS: 24,
  GALLERY: 30,
  HIGHLIGHTS: 8,
  SOCIALS: 6,
  SITE_NAME: 120,
  TAGLINE: 240,
  TITLE: 120,
  SUBTITLE: 240,
  SHORT: 160,
  BODY: 2000,
  URL: 600,
};

const SECTION_KINDS = [
  "hero",
  "services_catalog",
  "about",
  "testimonials",
  "gallery",
  "contact",
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
  };
}

function normalizeService(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  return {
    id: id(d.id),
    imageUrl: imageUrl(d.imageUrl),
    objectPosition: objectPosition(d.objectPosition),
    title: str(d.title, LIMITS.TITLE),
    description: str(d.description, LIMITS.SHORT * 2),
    // Preço é TEXTO de propósito: aqui ele é vitrine, não cobrança. Guardar
    // centavos sugeriria que este catálogo cobra — quem cobra é a Loja, com
    // Stripe, holdback e reembolso. Confundir os dois criaria uma segunda
    // verdade sobre preço no site.
    price: str(d.price, 40),
    duration: str(d.duration, 40),
    ctaText: str(d.ctaText, 40),
    ctaLink: link(d.ctaLink),
  };
}

function normalizeHighlight(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  return {
    id: id(d.id),
    title: str(d.title, 60),
    description: str(d.description, LIMITS.SHORT),
  };
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

  services_catalog: (d) => ({
    items: list(d.items, LIMITS.SERVICES, normalizeService),
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

  return {
    siteName: str(input.siteName, LIMITS.SITE_NAME),
    tagline: str(input.tagline, LIMITS.TAGLINE),
    theme: normalizeTheme(input.theme),
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
            },
          ],
        },
      },
      {
        id: crypto.randomUUID(),
        kind: "services_catalog",
        enabled: true,
        title: "O que oferecemos",
        subtitle: "Serviços e produtos da comunidade.",
        data: {
          columns: 3,
          items: [
            {
              id: crypto.randomUUID(),
              title: "Primeiro serviço",
              description: "Descreva aqui o que está incluso e para quem serve.",
              price: "R$ 0,00",
              duration: "1h",
              ctaText: "Quero este",
            },
            {
              id: crypto.randomUUID(),
              title: "Segundo serviço",
              description: "Troque este texto clicando direto nele.",
              price: "R$ 0,00",
              duration: "30min",
              ctaText: "Quero este",
            },
            {
              id: crypto.randomUUID(),
              title: "Terceiro serviço",
              description: "Adicione quantos quiser no botão de adicionar.",
              price: "R$ 0,00",
              duration: "2h",
              ctaText: "Quero este",
            },
          ],
        },
      },
      {
        id: crypto.randomUUID(),
        kind: "about",
        enabled: true,
        title: "Sobre nós",
        subtitle: "",
        data: {
          body:
            bio ||
            "Conte a história da comunidade: como começou, quem faz parte e o que vocês fazem juntos.",
          highlights: [
            {
              id: crypto.randomUUID(),
              title: "Nosso jeito",
              description: "O que torna esta comunidade diferente.",
            },
            {
              id: crypto.randomUUID(),
              title: "Para quem é",
              description: "Quem se sente em casa aqui.",
            },
          ],
          photos: avatar
            ? [{ id: crypto.randomUUID(), imageUrl: avatar, objectPosition: "center", caption: "" }]
            : [],
        },
      },
      {
        id: crypto.randomUUID(),
        kind: "contact",
        enabled: true,
        title: "Fale com a gente",
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
  SECTION_KINDS,
  DEFAULT_THEME,
  OBJECT_POSITIONS,
  normalizeConfig,
  normalizeSection,
  normalizeTheme,
  buildDefaultConfig,
  buildEmptySection,
};
