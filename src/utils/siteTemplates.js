// src/utils/siteTemplates.js
// OS TEMAS DO SITE FEITO PELA FREELANDOO (mig 241) — fonte ÚNICA.
//
// Um site gerenciado não tem seções: ele tem um TEMA (o componente autoral que
// desenha) e DADOS (o que muda de cliente para cliente). Este arquivo é o lado
// do servidor dessa dupla — ele diz quais temas existem e qual é a forma dos
// dados de cada um.
//
// ⚠️ TEMA NOVO ENTRA AQUI **E** NO ESPELHO DO FRONT (`lib/site-templates.ts`,
// que escolhe o componente). Faltando de um lado: ou o backend recusa dados que
// a página saberia desenhar, ou a página recebe um tema que não sabe montar.
// Mesma disciplina de `siteEvents.js` (mig 235) e de `section-content.ts`.
//
// ─── POR QUE ISTO NÃO PASSA PELO NORMALIZADOR DAS SEÇÕES ────────────────────
//
// `communitySite.js` valida um documento de seções e DESCARTA chave
// desconhecida — é essa regra que mantém a brecha do `template` fechada. Passar
// os dados do tema por lá apagaria todos eles, em silêncio: o save responderia
// sucesso e o site abriria vazio.
//
// ─── NORMALIZAR É O CONTRÁRIO DE CONFIAR ────────────────────────────────────
//
// Mesmo sendo uma porta só de admin, a saída é MONTADA campo a campo a partir
// da entrada — nunca é a entrada com um remendo. O dado destes temas é
// interpolado em HTML e em href no site de um cliente, e o dia em que essa
// porta for chamada por um script nosso com um JSON colado de qualquer lugar,
// quem segura é isto aqui.

const LIMITS = Object.freeze({
  /** Teto do documento inteiro, em bytes de JSON. */
  DATA_BYTES: 512 * 1024,
  SHORT: 120,
  LINE: 240,
  PARAGRAPH: 2000,
  SLUG: 80,
  URL: 2048,
  LIST: 40,
  PARAGRAPHS: 12,
});

/**
 * O byte nulo, montado em vez de escrito.
 *
 * Escrever a sequência de escape aqui poria um byte NUL DE VERDADE no
 * arquivo-fonte: o git passa a tratar o arquivo como binário (adeus diff) e
 * qualquer ferramenta que leia fonte como texto pode truncar nele. Mesmo
 * efeito, arquivo limpo.
 */
const NUL = String.fromCharCode(0);

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ─── Os tijolos ─────────────────────────────────────────────────────────────

/**
 * Texto: sem byte nulo, aparado e com teto.
 *
 * O byte nulo é o único caractere que quebra o JSONB do Postgres
 * ("unsupported Unicode escape sequence") — ele sai antes de chegar no banco.
 *
 * `replaceAll` e não regex de propósito: `/\u0000/g` é exatamente o padrão que
 * o eslint reprova em `no-control-regex`, e é o erro pré-existente que
 * `communitySite.js` carrega até hoje. Mesmo efeito, sem o aviso.
 */
function text(value, max = LIMITS.LINE) {
  if (typeof value !== "string") return "";
  return value.replaceAll(NUL, "").trim().slice(0, max);
}

function flag(value) {
  return value === true;
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function slug(value) {
  const raw = text(value, LIMITS.SLUG).toLowerCase();
  return SLUG_RE.test(raw) ? raw : "";
}

/**
 * Link: só `http(s)`, `mailto:` e `tel:`, mais o caminho interno começado por
 * "/". `javascript:` e `data:` num href são XSS no clique — e este dado vira
 * href no site de um cliente, sob o domínio dele.
 *
 * "//outro.site" é recusado: parece caminho interno e é endereço externo.
 */
function link(value) {
  const raw = text(value, LIMITS.URL);
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

/** Lista de parágrafos. Vazio some — parágrafo em branco vira buraco na página. */
function paragraphs(value, max = LIMITS.PARAGRAPHS) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, max)
    .map((p) => text(p, LIMITS.PARAGRAPH))
    .filter(Boolean);
}

/** Lista de textos curtos (formas de pagamento, sinais de "quando chamar"). */
function lines(value, max = LIMITS.LIST) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, max)
    .map((p) => text(p, LIMITS.LINE))
    .filter(Boolean);
}

/** Lista de objetos normalizados por `fn`. O que voltar vazio é descartado. */
function list(value, fn, max = LIMITS.LIST) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, max).map(fn).filter(Boolean);
}

/** Valor de lista fechada. Fora dela, o primeiro — nunca o que veio. */
function pick(value, allowed) {
  const raw = text(value, LIMITS.SHORT);
  return allowed.includes(raw) ? raw : allowed[0];
}

const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});

// ─── Blocos compartilhados entre temas ──────────────────────────────────────

/** Pergunta e resposta. Sem os dois lados, não é FAQ — é meia pergunta. */
function faqItem(raw) {
  const it = obj(raw);
  const q = text(it.q, LIMITS.LINE);
  const a = text(it.a, LIMITS.PARAGRAPH);
  return q && a ? { q, a } : null;
}

/** Título + texto (os itens de "o que cobre", "atendimento em X"). */
function titledItem(raw) {
  const it = obj(raw);
  const title = text(it.title, LIMITS.LINE);
  const body = text(it.text, LIMITS.PARAGRAPH);
  return title || body ? { title, text: body } : null;
}

/** Bloco de texto com título: `{ title, body: [...] }`. */
function prose(raw) {
  const it = obj(raw);
  return { title: text(it.title, LIMITS.LINE), body: paragraphs(it.body) };
}

// ─── Tema: oficina-local ────────────────────────────────────────────────────
//
// O prestador de serviço local — assistência técnica, oficina, barbearia,
// instalação. Uma página por SERVIÇO e uma por CIDADE atendida, que é o que
// responde em busca local, mais FAQ e depoimentos.
//
// ⚠️ O texto de cada serviço e de cada cidade é PRÓPRIO, nunca o mesmo com o
// nome trocado — página repetida com a cidade substituída é o padrão que o
// Google trata como conteúdo duplicado, e o efeito é o oposto do pretendido.
// Isso é regra editorial, não do código: o código aqui só garante a forma.

const OFICINA_ART = [
  "burner",
  "refit",
  "industrial",
  "clean",
  "griddle",
  "install",
];

function oficinaBusiness(raw) {
  const b = obj(raw);
  const geo = obj(b.geo);
  const lat = number(geo.lat);
  const lng = number(geo.lng);
  return {
    name: text(b.name, LIMITS.SHORT),
    legalName: text(b.legalName, LIMITS.SHORT),
    tagline: text(b.tagline, LIMITS.LINE),
    subTagline: text(b.subTagline, LIMITS.LINE),
    owner: text(b.owner, LIMITS.SHORT),

    // O telefone tem três formas porque tem três empregos: a que se lê, a do
    // `tel:` e a do WhatsApp. Derivar uma da outra parece economia e erra no
    // primeiro número com DDD de duas casas ou nono dígito ausente.
    phoneDisplay: text(b.phoneDisplay, LIMITS.SHORT),
    phoneE164: text(b.phoneE164, LIMITS.SHORT),
    whatsappNumber: text(b.whatsappNumber, LIMITS.SHORT).replace(/\D/g, ""),

    street: text(b.street, LIMITS.LINE),
    city: text(b.city, LIMITS.SHORT),
    state: text(b.state, 2).toUpperCase(),
    stateFull: text(b.stateFull, LIMITS.SHORT),
    postalCode: text(b.postalCode, 12),
    country: text(b.country, 2).toUpperCase() || "BR",

    // Coordenada só entra inteira: meia coordenada põe um alfinete no oceano.
    geo: lat !== null && lng !== null ? { lat, lng } : null,

    hoursHuman: text(b.hoursHuman, LIMITS.LINE),
    hoursShort: text(b.hoursShort, LIMITS.SHORT),
    closedHuman: text(b.closedHuman, LIMITS.LINE),
    payments: lines(b.payments, 12),
  };
}

function oficinaService(raw) {
  const s = obj(raw);
  const sl = slug(s.slug);
  const label = text(s.label, LIMITS.SHORT);
  // Sem endereço ou sem nome não há como montar a página nem o card — e uma
  // entrada pela metade viraria um item de menu que leva a lugar nenhum.
  if (!sl || !label) return null;

  const covers = obj(s.covers);
  const signs = obj(s.signs);
  return {
    slug: sl,
    label,
    h1: text(s.h1, LIMITS.LINE),
    metaTitle: text(s.metaTitle, LIMITS.LINE),
    metaDescription: text(s.metaDescription, LIMITS.LINE),
    eyebrow: text(s.eyebrow, LIMITS.SHORT),
    cardText: text(s.cardText, LIMITS.PARAGRAPH),
    art: pick(s.art, OFICINA_ART),
    photo: link(s.photo),
    waMessage: text(s.waMessage, LIMITS.LINE),
    intro: paragraphs(s.intro),
    problem: prose(s.problem),
    covers: {
      title: text(covers.title, LIMITS.LINE),
      body: paragraphs(covers.body),
      items: list(covers.items, titledItem),
    },
    signs: {
      title: text(signs.title, LIMITS.LINE),
      lead: text(signs.lead, LIMITS.PARAGRAPH),
      items: lines(signs.items),
    },
    faq: list(s.faq, faqItem),
    // ⚠️ Os slugs relacionados NÃO são conferidos contra a lista de serviços.
    // Conferir faria apagar um serviço recusar o documento inteiro por causa de
    // um "veja também" pendente; o tema ignora o que não encontrar, que é o
    // comportamento honesto.
    related: list(s.related, (r) => slug(r) || null, 6),
  };
}

function oficinaCity(raw) {
  const c = obj(raw);
  const sl = slug(c.slug);
  const name = text(c.name, LIMITS.SHORT);
  if (!sl || !name) return null;

  const focus = obj(c.focus);
  return {
    slug: sl,
    name,
    // "em Aguaí", "em São João da Boa Vista" — a preposição vem pronta porque
    // concordância não se resolve com concatenação.
    prep: text(c.prep, LIMITS.SHORT),
    uf: text(c.uf, 2).toUpperCase(),
    isBase: flag(c.isBase),
    h1: text(c.h1, LIMITS.LINE),
    metaTitle: text(c.metaTitle, LIMITS.LINE),
    metaDescription: text(c.metaDescription, LIMITS.LINE),
    eyebrow: text(c.eyebrow, LIMITS.SHORT),
    cardText: text(c.cardText, LIMITS.PARAGRAPH),
    intro: paragraphs(c.intro),
    context: prose(c.context),
    focus: {
      title: text(focus.title, LIMITS.LINE),
      lead: text(focus.lead, LIMITS.PARAGRAPH),
      items: list(focus.items, titledItem),
    },
    faq: list(c.faq, faqItem),
    waMessage: text(c.waMessage, LIMITS.LINE),
  };
}

/**
 * Depoimento.
 *
 * ⚠️ `source` é obrigatório de propósito. Elogio sem origem publicado como fala
 * de outra pessoa é a única coisa deste documento que seria uma mentira sobre
 * alguém — e é por isso que o site semeado pelo construtor também nunca traz
 * depoimento de exemplo.
 */
function oficinaReview(raw) {
  const r = obj(raw);
  const quote = text(r.quote, LIMITS.PARAGRAPH);
  const source = text(r.source, LIMITS.LINE);
  return quote && source ? { quote, source } : null;
}

function normalizeOficinaLocal(raw) {
  const d = obj(raw);
  const services = list(d.services, oficinaService, 24);
  const cities = list(d.cities, oficinaCity, 24);

  // Dois endereços iguais dariam duas páginas disputando a mesma URL, e quem
  // ganha seria a ordem do array — invisível para quem escreveu. A primeira
  // fica, mesma regra das sub-páginas do construtor (mig 238).
  const dedupe = (arr) => {
    const seen = new Set();
    return arr.filter((it) => (seen.has(it.slug) ? false : seen.add(it.slug)));
  };

  return {
    business: oficinaBusiness(d.business),
    services: dedupe(services),
    cities: dedupe(cities),
    reviews: list(d.reviews, oficinaReview, 24),
    faq: list(d.faq, faqItem),
    googleProfileUrl: link(d.googleProfileUrl),
    /** Mensagem do WhatsApp quando a página não tem uma própria. */
    waDefault: text(d.waDefault, LIMITS.LINE),
  };
}

// ─── O registro ─────────────────────────────────────────────────────────────

const TEMPLATES = Object.freeze({
  "oficina-local": {
    label: "Oficina / prestador local",
    normalize: normalizeOficinaLocal,
  },
});

const TEMPLATE_SLUGS = Object.freeze(Object.keys(TEMPLATES));

function isTemplate(value) {
  return typeof value === "string" && Object.hasOwn(TEMPLATES, value);
}

/**
 * Normaliza os dados de um tema.
 *
 * Devolve `{ error }` quando o tema não existe — recusar em voz alta, e não
 * cair num tema qualquer: gravar dados de barbearia sob o tema de oficina
 * publicaria uma página com os campos trocados e ninguém saberia por quê.
 *
 * O teto de tamanho é medido DEPOIS de normalizar: antes, mediria o lixo que a
 * normalização ia descartar de qualquer forma.
 */
function normalizeTemplateData(template, raw) {
  if (!isTemplate(template)) {
    return { error: `Tema desconhecido: ${String(template).slice(0, 48)}` };
  }
  const data = TEMPLATES[template].normalize(raw);
  const bytes = Buffer.byteLength(JSON.stringify(data), "utf8");
  if (bytes > LIMITS.DATA_BYTES) {
    return {
      error: `Conteúdo do site grande demais (${Math.round(bytes / 1024)} KB; o teto é ${
        LIMITS.DATA_BYTES / 1024
      } KB).`,
    };
  }
  return { data };
}

module.exports = {
  LIMITS,
  TEMPLATES,
  TEMPLATE_SLUGS,
  isTemplate,
  normalizeTemplateData,
};
