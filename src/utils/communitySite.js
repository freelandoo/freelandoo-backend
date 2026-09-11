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

// ─── QUEM PODE TER SITE ─────────────────────────────────────────────────────
//
// Decisão do Alex (2026-09-07): "só meus negócios tem site, o restante não tem,
// nenhuma comunidade mais". O site é uma vitrine comercial — catálogo de
// serviços, agendamento, depoimentos, contato. Isso responde a uma pergunta que
// só a comunidade de NEGÓCIO faz (a `common`, a que o pill "Business" do
// headcard abre). A comunidade do cachorro, a do modelo de carro, a da rua, a
// do prédio e a plataforma de games não vendem nada, e uma aba "Site" nelas era
// uma porta pintada: abria um construtor para montar uma página que ninguém ia
// procurar.
//
// ⚠️ O PREDICADO É UM SÓ, e é este. Espalhado como `kind === "common"` por cada
// porta do site, a porta que esquecesse voltaria a oferecer o construtor — e
// oferecer para depois recusar é pior do que não oferecer. Ele vale para TODAS
// as portas: ler, salvar, publicar, renomear o endereço, subir imagem e servir
// o site publicado por slug/domínio.
//
// O espelho do front é `kindHasSite` em `comunidades/[id]/_components/community-ui.ts`.
const SITE_KINDS = ["common"];

/** Esta modalidade de comunidade pode ter site? */
function kindHasSite(kind) {
  // `null`/ausente é comunidade comum: `community_kind` é NOT NULL com default
  // 'common' desde a mig 219, mas leitura antiga que não projete a coluna não
  // pode perder o site que já existe.
  return SITE_KINDS.includes(kind || "common");
}

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
  // Sub-páginas do site (E1). O teto é baixo de propósito: o construtor é um
  // site de negócio, não um gerenciador de conteúdo — passar disso é sinal de
  // que a pessoa queria outra ferramenta.
  PAGES: 12,
  // Perguntas frequentes de uma seção `faq`.
  FAQ_ITEMS: 20,
  // Cidades/bairros de uma seção `areas`.
  AREA_ITEMS: 24,
  PAGE_SLUG: 48,
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
  // Deslocamento da caixa dentro do bloco dela. O eixo X é em % da largura do
  // BLOCO (a mesma regua de `width`) e o Y em pixels, e a diferenca nao e
  // capricho: o que muda entre o computador e o celular e a LARGURA, entao um
  // X gravado em pixels jogaria a caixa para fora da tela no aparelho menor,
  // enquanto a altura de um texto nao acompanha a largura da janela.
  X_MIN: -100,
  X_MAX: 100,
  Y_MIN: -600,
  Y_MAX: 600,
  // Respiro vertical da secao (o `py` de cima e de baixo), em pixels. Zero e
  // valor legitimo: e ele que deixa a secao encostar no conteudo quando o
  // lider aperta a linha divisoria ate o fim.
  PADY_MIN: 0,
  PADY_MAX: 240,
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
  "faq",
  "areas",
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
 * O destino interno da página de agendamento do próprio site (mig 221).
 *
 * É um TOKEN, e não "/agendar", porque o mesmo site é servido em três
 * endereços: `freelandoo.com.br/c/padaria`, `padaria.freelandoo.com.br` e o
 * domínio próprio. Um caminho absoluto gravado no documento estaria certo em um
 * deles e errado nos outros dois — quem sabe montar o endereço é o front, que
 * conhece por onde a página está sendo servida.
 */
const BOOKING_LINK = "agendar";

/**
 * Destino de uma SUB-PÁGINA do próprio site: `pagina:<slug>`.
 *
 * Token pela MESMA razão do `agendar` acima, e a armadilha aqui é maior porque
 * um caminho parece funcionar: gravar "/servicos" acerta em
 * `freelandoo.com.br/c/padaria` — não, nem lá: o endereço real é
 * `/c/padaria/servicos`. Erra nos TRÊS. Quem monta o endereço é o front, que
 * sabe por onde a página está sendo servida.
 *
 * O slug NÃO é conferido contra as páginas existentes aqui: apagar uma página
 * deixaria links pendentes e o save recusaria a edição inteira por causa deles.
 * Link para página que sumiu vira 404, que é o comportamento honesto.
 */
const PAGE_LINK_PREFIX = "pagina:";

/**
 * Alfabeto do endereço de uma sub-página. Ele vira segmento de URL e chave de
 * roteamento, então é kebab-case puro — sem acento, sem barra, sem ponto.
 */
const PAGE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Endereços que uma sub-página NÃO pode tomar.
 *
 * `agendar` é a página de agendamento da mig 221 e já responde nesse caminho —
 * uma sub-página com esse slug seria invisível, e o líder não teria como saber
 * por quê. Os outros são caminhos que o Next reserva na origem do site.
 */
const RESERVED_PAGE_SLUGS = new Set([
  BOOKING_LINK,
  "api",
  "_next",
  "favicon.ico",
  "robots.txt",
  "sitemap.xml",
]);

/**
 * URL de destino. Aceita http(s), mailto:, tel:, caminho interno começando com
 * "/" e o token `agendar`. Recusa TODO o resto — `javascript:` e `data:` num
 * href viram XSS no clique, e a seção de contato é justamente onde um link
 * entra.
 */
function link(value) {
  const raw = str(value, LIMITS.URL);
  if (!raw) return "";
  if (raw === BOOKING_LINK) return raw;
  if (raw.startsWith(PAGE_LINK_PREFIX)) {
    const slug = raw.slice(PAGE_LINK_PREFIX.length);
    return PAGE_SLUG_RE.test(slug) && slug.length <= LIMITS.PAGE_SLUG ? raw : "";
  }
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

function normalizeFaqItem(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  return {
    id: id(d.id),
    question: str(d.question, LIMITS.TITLE),
    answer: str(d.answer, LIMITS.SHORT * 4),
  };
}

function normalizeAreaItem(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  return {
    id: id(d.id),
    name: str(d.name, 60),
    // Sigla do estado. Livre e curta: a lista de UF muda pouco, mas fechá-la
    // aqui obrigaria a tocar nesta fonte para atender fora do Brasil.
    uf: str(d.uf, 4),
    note: str(d.note, LIMITS.SHORT),
    // Para onde o item leva: outra sub-página ("pagina:aguai"), o agendamento
    // ou um link externo. Vazio = o item é só informativo, sem clique.
    url: link(d.url),
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

  /**
   * Perguntas frequentes.
   *
   * Ganha seção própria porque é o bloco que mais rende em busca: o Google lê
   * pergunta-e-resposta como FAQPage e mostra o par direto no resultado. Posto
   * como texto corrido dentro de "sobre", esse ganho não existe.
   */
  faq: (d) => ({
    items: list(d.items, LIMITS.FAQ_ITEMS, normalizeFaqItem),
  }),

  /**
   * Áreas atendidas.
   *
   * Existe separada de "contato" porque responde outra pergunta: contato é
   * "onde você está", área atendida é "até onde você vai" — e é esta que decide
   * se quem está na cidade vizinha liga ou não.
   */
  areas: (d) => ({
    items: list(d.items, LIMITS.AREA_ITEMS, normalizeAreaItem),
    columns: [2, 3, 4].includes(Number(d.columns)) ? Number(d.columns) : 3,
    note: str(d.note, LIMITS.SHORT),
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
 * da coluna de conteúdo. Só isso — seção não tem posição. Elas são empilhadas
 * uma sob a outra, e arrastar UMA para (x, y) abriria um buraco no lugar dela
 * sem dizer por quê. O deslocamento existe só para a CAIXA DE TEXTO, dentro do
 * bloco em que ela já mora (ver `normalizeTextStyles`).
 */
function normalizeLayout(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  return {
    minHeight: num(d.minHeight, SIZES.HEIGHT_MIN, SIZES.HEIGHT_MAX),
    maxWidth: num(d.maxWidth, SIZES.MAXW_MIN, SIZES.MAXW_MAX),
    // ⚠️ `padY` existe porque `minHeight` sozinho SO CRESCE: as secoes tem um
    // respiro fixo no CSS (`py-16 md:py-24`), entao pedir uma altura menor que
    // o conteudo + esse respiro nao encolhia nada, e a alca parecia quebrada.
    // Quem cede primeiro quando o lider aperta a linha divisoria e o respiro.
    // ⚠️ ZERO e escolha, nao ausencia — por isso `num` (que so devolve null
    // para vazio/NaN) e nunca um `|| null`, que engoliria o 0.
    padY: num(d.padY, SIZES.PADY_MIN, SIZES.PADY_MAX),
  };
}

/**
 * Tamanho e POSICAO por CAIXA DE TEXTO, num mapa
 * `caminho -> { fontSize, width, x, y }`.
 *
 * `x`/`y` sao deslocamento, nao coordenada absoluta: o front os aplica como
 * `left`/`top` de um elemento `position: relative`, que desloca a caixa SEM
 * tirar o espaco dela do fluxo. E o que permite mover uma manchete alguns
 * dedos para o lado sem que o paragrafo de baixo suba junto — e o que mantem
 * a pagina responsiva para quem visita, diferente de um `position: absolute`,
 * que congelaria a caixa num ponto da tela do computador.
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
    const x = num(d.x, SIZES.X_MIN, SIZES.X_MAX);
    const y = num(d.y, SIZES.Y_MIN, SIZES.Y_MAX);
    // Entrada sem tamanho E sem deslocamento é lixo: gravá-la só ocuparia o
    // teto. ⚠️ Zero é escolha do líder ("de volta ao lugar"), não ausência —
    // por isso a comparação é com null, e nunca por valor falsy.
    if (fontSize === null && width === null && x === null && y === null) continue;
    out[key] = { fontSize, width, x, y };
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

/**
 * Endereço da sub-página. Devolve "" quando não serve — quem chama decide o
 * que fazer com isso (aqui, descartar a página).
 */
function pageSlug(value) {
  const raw = str(value, LIMITS.PAGE_SLUG).toLowerCase();
  if (!PAGE_SLUG_RE.test(raw)) return "";
  if (RESERVED_PAGE_SLUGS.has(raw)) return "";
  return raw;
}

/**
 * Sub-página do site: um endereço próprio e a mesma pilha de seções da home.
 *
 * É a MESMA `normalizeSection` de propósito. Uma segunda lista de seções "de
 * sub-página" faria a seção nova nascer num lugar e faltar no outro, e a
 * divergência só apareceria quando alguém montasse a página.
 *
 * `title` é o que vai para a aba do navegador e para o resultado de busca;
 * `subtitle` é a descrição. Sem página sem endereço: slug inválido devolve
 * null e a página é descartada, como o kind fora da lista.
 */
function normalizePage(raw) {
  if (!raw || typeof raw !== "object") return null;
  const slug = pageSlug(raw.slug);
  if (!slug) return null;
  return {
    id: id(raw.id),
    slug,
    title: str(raw.title, LIMITS.TITLE),
    subtitle: str(raw.subtitle, LIMITS.SUBTITLE),
    enabled: bool(raw.enabled, true),
    sections: Array.isArray(raw.sections)
      ? raw.sections.slice(0, LIMITS.SECTIONS).map(normalizeSection).filter(Boolean)
      : [],
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

  // Sub-páginas (E1). Ausentes, o site é o de sempre: uma página só. Chave nova
  // num documento antigo não muda nada — é o que mantém no ar quem já publicou.
  const pages = Array.isArray(input.pages)
    ? input.pages.slice(0, LIMITS.PAGES).map(normalizePage).filter(Boolean)
    : [];

  // Dois endereços iguais dariam duas páginas disputando a mesma URL, e quem
  // ganha seria a ordem do array — invisível para quem edita. A primeira fica.
  const seenSlugs = new Set();
  const uniquePages = [];
  for (const page of pages) {
    if (seenSlugs.has(page.slug)) continue;
    seenSlugs.add(page.slug);
    uniquePages.push(page);
  }

  // ⚠️ Ids repetidos quebram a reordenação e a remoção no construtor (remover
  // uma seção removeria a irmã de mesmo id), então o segundo ganha id novo.
  //
  // O desempate é do SITE INTEIRO, e não de cada página: as chaves de
  // `textStyles` são globais (`sec:<id>`), então uma seção da home e uma de
  // sub-página com o mesmo id dividiriam o tamanho do texto — mexer numa
  // mudaria a outra, à distância e sem aviso.
  const seen = new Set();
  for (const section of allSections(sections, uniquePages)) {
    if (seen.has(section.id)) section.id = crypto.randomUUID();
    seen.add(section.id);
  }

  // Depois do desempate, não antes: a seção que trocou de id perdeu a
  // identidade, e os tamanhos que apontavam para o id velho não são dela.
  //
  // ⚠️ E com as seções de TODAS as páginas: a poda apaga a entrada cujo id não
  // está vivo, então deixar as sub-páginas de fora zeraria, em silêncio, todo
  // tamanho de texto escolhido fora da home.
  const liveSectionIds = new Set(
    [...allSections(sections, uniquePages)].map((s) => s.id),
  );

  return {
    siteName: str(input.siteName, LIMITS.SITE_NAME),
    tagline: str(input.tagline, LIMITS.TAGLINE),
    theme: normalizeTheme(input.theme),
    textStyles: normalizeTextStyles(input.textStyles, liveSectionIds),
    sections,
    pages: uniquePages,
  };
}

/** Toda seção do site, na ordem: a home primeiro, depois cada sub-página. */
function* allSections(homeSections, pages) {
  yield* homeSections;
  for (const page of pages) yield* page.sections;
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
              // A porta principal do site é agendar — e o botão da barra fixa
              // é DERIVADO deste (o primeiro banner), então os dois nascem
              // apontando para a mesma página, sem campo novo na casca.
              ctaText: "Agendar online",
              ctaUrl: BOOKING_LINK,
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
          ctaText: "Agendar agora",
          ctaUrl: BOOKING_LINK,
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
  PAGE_LINK_PREFIX,
  RESERVED_PAGE_SLUGS,
  normalizePage,
  SITE_KINDS,
  kindHasSite,
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
  BOOKING_LINK,
};
