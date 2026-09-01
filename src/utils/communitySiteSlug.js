// src/utils/communitySiteSlug.js
// FONTE ÚNICA do endereço próprio do site da comunidade (mig 213).
//
// O slug tem uma responsabilidade dupla que o torna mais delicado do que
// parece: ele é ao mesmo tempo um pedaço de URL (`/c/<slug>`) e um RÓTULO DE
// DNS (`<slug>.dominio`). O DNS é o mais restritivo dos dois, então é a regra
// dele que vale aqui — 63 caracteres, só letras minúsculas, números e hífen,
// sem começar nem terminar em hífen.
//
// A lista de reservados existe por um motivo concreto: no dia do subdomínio,
// uma comunidade chamada "www", "api" ou "mail" SEQUESTRARIA um endereço de
// infraestrutura do próprio site. O estrago não apareceria no degrau de agora
// (`/c/www` é inofensivo) e sim meses depois, quando o subdomínio entrasse —
// por isso a lista nasce junto com o slug, e não junto com o subdomínio.

const { slugify } = require("./slug");

const MIN_LENGTH = 3;
const MAX_LENGTH = 63; // um rótulo de DNS (RFC 1035)

/**
 * Nomes que NUNCA podem virar slug de comunidade.
 *
 * Três famílias:
 *  1. infraestrutura de DNS/e-mail (www, mail, smtp, ns1…) — sequestrariam um
 *     endereço técnico do domínio;
 *  2. rotas e serviços do próprio produto (admin, api, checkout, conta…) —
 *     `admin.dominio` de propriedade de um usuário é uma máquina de phishing
 *     apontando para dentro de casa;
 *  3. palavras que confundem quem lê a barra de endereços (login, seguranca,
 *     suporte, oficial, pagamento) — usadas justamente em golpe.
 */
const RESERVED = new Set([
  // 1. infraestrutura
  "www", "ftp", "mail", "email", "smtp", "imap", "pop", "pop3", "mx",
  "ns", "ns1", "ns2", "dns", "cdn", "static", "assets", "img", "imgs",
  "media", "files", "arquivos", "storage", "r2", "s3", "bucket",
  "localhost", "autodiscover", "autoconfig", "_domainkey", "dmarc", "spf",
  // 2. produto e plataforma
  "api", "app", "admin", "administracao", "administrador", "backend", "back",
  "front", "web", "site", "sites", "painel", "dashboard", "console",
  "ws", "wss", "socket", "realtime", "webhook", "webhooks", "callback",
  "dev", "staging", "stage", "test", "teste", "beta", "alpha", "preview",
  "demo", "sandbox", "local", "prod", "producao",
  "status", "health", "metrics", "monitor",
  "blog", "docs", "doc", "ajuda", "help", "faq", "suporte", "support",
  "loja", "store", "shop", "checkout", "pagamento", "pagamentos", "pay",
  "billing", "cobranca", "assinatura", "assinaturas", "carteira", "wallet",
  "conta", "account", "perfil", "perfis", "usuario", "usuarios", "user",
  "login", "logout", "entrar", "sair", "cadastro", "signup", "signin",
  "auth", "oauth", "sso", "id", "senha", "password", "reset",
  "comunidade", "comunidades", "community", "communities",
  "feed", "bees", "curtos", "stories", "mensagens", "chat", "lives", "live",
  "ranking", "busca", "search", "explorar", "vitrine",
  "cursos", "curso", "academia", "academias", "fitness", "vaquinha",
  "afiliado", "afiliados", "parceiro", "parceiros", "indicacao",
  "polens", "polen", "premium", "manifestacao", "funcoes", "bairro", "condominio",
  "termos", "privacidade", "legal", "politica", "politicas", "cookies",
  "sobre", "contato", "imprensa", "press", "carreiras", "jobs",
  "freelandoo", "freelandoogroup", "acasaviews", "casaviews",
  // 3. palavras de golpe
  "seguranca", "security", "secure", "oficial", "official", "verificado",
  "verify", "verificacao", "atendimento", "sac", "ouvidoria", "banco",
  "nfe", "boleto", "pix",
]);

/** O nome está reservado? Compara já normalizado. */
function isReserved(slug) {
  return RESERVED.has(String(slug || "").toLowerCase());
}

/**
 * Normaliza um texto qualquer para a forma de slug.
 * Devolve "" quando não sobra nada aproveitável — quem chama decide o que
 * fazer com isso (o gerador automático cai num nome derivado do id).
 */
function normalizeSlug(input) {
  const base = slugify(input);
  if (!base) return "";
  return base.slice(0, MAX_LENGTH).replace(/-+$/g, "");
}

/**
 * Valida um slug ESCOLHIDO À MÃO pelo líder.
 * Devolve `{ ok: true, slug }` ou `{ ok: false, reason }` — nunca lança, porque
 * o caminho de erro aqui é comum (o líder vai testar nomes) e merece uma
 * mensagem, não uma exceção.
 */
function validateSlug(input) {
  // O comprimento é conferido no texto CRU, antes de normalizar.
  //
  // `normalizeSlug` corta em MAX_LENGTH — o que é certo para o gerador
  // automático (ele só precisa de um nome válido) e ERRADO aqui: quem digitou
  // um endereço de 80 caracteres receberia calado um endereço diferente do que
  // pediu, e só descobriria ao ver o link. Escolha à mão merece um "não cabe",
  // não uma troca silenciosa.
  if (typeof input === "string" && slugify(input).length > MAX_LENGTH) {
    return { ok: false, reason: "too_long" };
  }

  const slug = normalizeSlug(input);
  if (!slug) return { ok: false, reason: "empty" };
  if (slug.length < MIN_LENGTH) return { ok: false, reason: "too_short" };
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return { ok: false, reason: "format" };
  if (isReserved(slug)) return { ok: false, reason: "reserved" };
  // Um rótulo de DNS não pode ser só números — viraria ambíguo com um IP.
  if (/^\d+$/.test(slug)) return { ok: false, reason: "numeric_only" };

  // Punycode (`xn--`) é reservado pelo DNS para nome internacionalizado, e um
  // slug com essa cara confundiria resolvedor.
  //
  // Na prática esta linha é INALCANÇÁVEL por aqui: `normalizeSlug` passa pelo
  // `slugify`, que colapsa "--" em "-", então "xn--abc" já chega como
  // "xn-abc" — que não é punycode e é inofensivo. Ela fica como defesa em
  // profundidade, para o dia em que alguém afrouxar o slugify ou chamar esta
  // validação com um valor que não passou por ele. Não é um caso a "consertar".
  if (/^..--/.test(slug)) return { ok: false, reason: "punycode_like" };

  return { ok: true, slug };
}

module.exports = {
  MIN_LENGTH,
  MAX_LENGTH,
  RESERVED,
  isReserved,
  normalizeSlug,
  validateSlug,
};
