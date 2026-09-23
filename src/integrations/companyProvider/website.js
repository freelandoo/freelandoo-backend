// src/integrations/companyProvider/website.js
// O SITE OFICIAL da empresa — a fonte dos canais comerciais.
//
// É aqui que estão o WhatsApp, o e-mail de contato e o Instagram: a Receita não
// os tem e o OSM quase nunca. Sem este provider, o filtro "com WhatsApp" — o
// que separa um lead abordável de uma linha de cadastro — ficaria quase sempre
// vazio.
//
// ─── ⚠️ ESTE É O ARQUIVO PERIGOSO DO SUBSISTEMA ─────────────────────────────
//
// Ele é a única peça da plataforma que busca uma URL ESCOLHIDA POR DADO
// EXTERNO. Um domínio vindo do OSM (que qualquer pessoa edita) vira uma
// requisição feita de DENTRO da rede do Railway. Sem as travas abaixo isso é um
// SSRF clássico: alguém edita um ponto no OSM apontando `website` para o
// endpoint de metadados da nuvem e a plataforma busca as credenciais dela
// mesma e as guarda num campo de e-mail.
//
// As seis travas, e o que cada uma impede:
//
//   1. HTTP(S) apenas          — `file://`, `gopher://` e afins fora.
//   2. DNS → IP público        — reusa `isPrivateIp` de utils/webhookUrl.js
//                                (loopback, 10/8, 172.16/12, 192.168/16,
//                                169.254/16 — que é o metadata da AWS/GCP —,
//                                CGNAT e os equivalentes IPv6).
//   3. REDIRECT MANUAL         — ⚠️ a mais fácil de esquecer. `fetch` segue
//                                redirect sozinho: um host público que responde
//                                302 para `http://169.254.169.254/` fura as
//                                travas 1 e 2 se elas só olharem a URL inicial.
//                                Cada salto é revalidado.
//   4. TETO DE BYTES           — leitura em pedaços com corte. Sem isso, um
//                                "site" que responde um stream infinito derruba
//                                o processo por memória.
//   5. TETO DE PÁGINAS         — `crawl_max_pages` (6). Não somos um crawler.
//   6. robots.txt + intervalo  — cortesia, e o que mantém a plataforma fora das
//                                listas de bloqueio.

const dns = require("dns").promises;
const { createLogger } = require("../../utils/logger");
const { isPrivateIp } = require("../../utils/webhookUrl");
const N = require("../../utils/companyNormalize");

const log = createLogger("companyProvider.website");

const UA = "FreelandooBot/1.0 (+https://www.freelandoo.com.br/robots)";
const TIMEOUT_MS = 10_000;
/** 1,5 MB por página. Página de contato honesta não chega perto disso. */
const MAX_BYTES = 1_500_000;
const MAX_REDIRECTS = 4;
/** Pausa entre páginas do MESMO domínio. Cortesia mínima. */
const POLITE_DELAY_MS = 1200;

/**
 * Os caminhos que o pedido nomeia, nesta ordem.
 *
 * ⚠️ A ORDEM É A PROBABILIDADE, e ela importa por causa do teto de 6 páginas:
 * a home quase sempre tem o WhatsApp no rodapé, e `/contato` é o caminho mais
 * usado no Brasil. Gastar as seis visitas em `/about` primeiro deixaria de fora
 * justamente onde o contato está.
 */
const CANDIDATE_PATHS = ["/", "/contato", "/contatos", "/contact", "/sobre", "/about"];

function isConfigured() {
  return String(process.env.WEBSITE_CRAWL || "on").toLowerCase() !== "off";
}

/** Guard de destino. `{ ok }` ou `{ error }`. Roda em CADA salto de redirect. */
async function assertPublicUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || ""));
  } catch {
    return { error: "url_invalida" };
  }
  if (!["http:", "https:"].includes(url.protocol)) return { error: "protocolo" };
  let addresses;
  try {
    addresses = await dns.lookup(url.hostname, { all: true });
  } catch {
    return { error: "dns" };
  }
  // ⚠️ `some`, e não `every`: um host que resolve para um IP público E um
  // privado (DNS rebinding) é recusado inteiro.
  if (!addresses.length || addresses.some((a) => isPrivateIp(a.address))) {
    return { error: "rede_privada" };
  }
  return { ok: true, url };
}

/**
 * GET com as travas. Devolve `{ html, finalUrl }` ou `null`.
 *
 * O corpo é lido em PEDAÇOS e cortado no teto — `res.text()` leria o stream
 * inteiro antes de qualquer verificação de tamanho, que é exatamente o que a
 * trava 4 existe para impedir.
 */
async function getHtml(rawUrl) {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const guard = await assertPublicUrl(current);
    if (guard.error) {
      log.warn("website.blocked", { url: String(current).slice(0, 200), reason: guard.error });
      return null;
    }
    let res;
    try {
      res = await fetch(guard.url, {
        headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return null;
    }
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get("location");
      if (!loc) return null;
      current = new URL(loc, guard.url).toString();
      continue;
    }
    if (!res.ok) return null;
    const type = res.headers.get("content-type") || "";
    // PDF, imagem e afins não têm o que extrair e custam banda à toa.
    if (!type.toLowerCase().includes("html")) return null;

    const reader = res.body?.getReader?.();
    if (!reader) return null;
    const chunks = [];
    let size = 0;
    while (size < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      chunks.push(value);
    }
    try {
      await reader.cancel();
    } catch {
      /* stream já encerrado — nada a fazer */
    }
    const html = Buffer.concat(chunks).toString("utf8").slice(0, MAX_BYTES);
    return { html, finalUrl: guard.url.toString() };
  }
  return null;
}

/**
 * robots.txt — só o que importa aqui: `Disallow: /` para o nosso UA ou para `*`.
 *
 * ⚠️ FALHA ABERTA DE PROPÓSITO. robots.txt que não responde (404, timeout, host
 * sem o arquivo) é o caso COMUM no comércio local, e tratá-lo como proibição
 * deixaria o enriquecimento mudo para quase todo mundo. Proibição só vale
 * quando ela foi de fato declarada.
 */
async function isCrawlAllowed(origin) {
  try {
    const guard = await assertPublicUrl(`${origin}/robots.txt`);
    if (guard.error) return false;
    const res = await fetch(guard.url, {
      headers: { "User-Agent": UA },
      redirect: "manual",
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return true;
    const txt = (await res.text()).slice(0, 50_000);
    const lines = txt.split(/\r?\n/).map((l) => l.trim());
    let applies = false;
    let disallowRoot = false;
    for (const line of lines) {
      const [rawKey, ...rest] = line.split(":");
      const key = String(rawKey || "").trim().toLowerCase();
      const value = rest.join(":").trim();
      if (key === "user-agent") {
        const ua = value.toLowerCase();
        applies = ua === "*" || ua.includes("freelandoo");
      } else if (applies && key === "disallow" && value === "/") {
        disallowRoot = true;
      }
    }
    return !disallowRoot;
  } catch {
    return true;
  }
}

// ─── EXTRAÇÃO ────────────────────────────────────────────────────────────────

const RE_MAILTO = /mailto:([^"'?>\s]+)/gi;
const RE_EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const RE_WA = /(?:wa\.me\/|api\.whatsapp\.com\/send\?phone=|whatsapp:\/\/send\?phone=)(\+?\d{8,15})/gi;
const RE_TEL = /tel:([+\d\s().-]{8,20})/gi;
const RE_PHONE_TEXT = /\(?\b\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}\b/g;
const RE_CNPJ = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;

/**
 * E-mails que NUNCA são o contato comercial da empresa.
 *
 * ⚠️ SEM ESTA LISTA O CRAWLER ENVENENA A BASE. Todo site feito em template
 * carrega o e-mail de quem o fez, e sem filtro a plataforma anunciaria o
 * suporte do Wix como "e-mail da padaria" — com confiança de FONTE OFICIAL
 * (o site é 80 na escada), sobrescrevendo dados melhores.
 */
const EMAIL_BLOCKLIST = [
  "example.com", "sentry.io", "wixpress.com", "wix.com", "squarespace.com",
  "godaddy.com", "shopify.com", "elementor.com", "wordpress.com", "webflow.com",
  "sentry-next.wixpress.com", "domain.com", "email.com", "seudominio.com",
  "yourdomain.com", "site.com", "jimdo.com", "weebly.com",
];

function pickEmail(html, domain) {
  const found = new Set();
  for (const m of html.matchAll(RE_MAILTO)) {
    const e = N.normalizeEmail(decodeURIComponent(m[1]));
    if (e) found.add(e);
  }
  for (const m of html.matchAll(RE_EMAIL)) {
    const e = N.normalizeEmail(m[0]);
    if (e) found.add(e);
  }
  const list = [...found].filter((e) => {
    const host = e.split("@")[1] || "";
    if (EMAIL_BLOCKLIST.some((b) => host === b || host.endsWith(`.${b}`))) return false;
    // Extensão de imagem colada no e-mail é falso positivo do regex sobre CSS.
    if (/\.(png|jpe?g|gif|svg|webp|css|js)$/i.test(e)) return false;
    return true;
  });
  if (!list.length) return null;
  // ⚠️ E-MAIL DO PRÓPRIO DOMÍNIO VENCE. `contato@padariadoze.com.br` é da
  // empresa; um gmail solto no rodapé pode ser de qualquer um.
  const own = domain ? list.find((e) => (e.split("@")[1] || "").endsWith(domain)) : null;
  return own || list[0];
}

function pickWhatsapp(html) {
  for (const m of html.matchAll(RE_WA)) {
    const p = N.normalizePhone(m[1]);
    if (p) return p;
  }
  return null;
}

function pickPhone(html) {
  for (const m of html.matchAll(RE_TEL)) {
    const p = N.normalizePhone(m[1]);
    if (p) return p;
  }
  for (const m of html.matchAll(RE_PHONE_TEXT)) {
    const p = N.normalizePhone(m[0]);
    if (p) return p;
  }
  return null;
}

/**
 * CNPJ no rodapé — o achado mais valioso deste provider.
 *
 * ⚠️ ELE É O QUE DESTRAVA A FONTE OFICIAL. Sem CNPJ, `cnpj.js` não tem como
 * ser consultado (a API é endereçada por CNPJ). É este regex, sobre o rodapé
 * do site, que transforma um ponto do OSM numa empresa com razão social,
 * porte e situação cadastral.
 *
 * O dígito verificador é conferido: o regex casa com qualquer sequência no
 * formato, inclusive um número de pedido.
 */
function pickCnpj(html) {
  for (const m of html.matchAll(RE_CNPJ)) {
    const c = N.normalizeCnpj(m[0]);
    if (c && N.isValidCnpj(c)) return c;
  }
  return null;
}

const SOCIAL_RE = {
  instagram: /(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9._]{2,40})/i,
  facebook: /(?:https?:\/\/)?(?:www\.)?facebook\.com\/([A-Za-z0-9.\-_]{2,60})/i,
  linkedin: /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/(?:company|in|school)\/([A-Za-z0-9\-_]{2,60})/i,
  tiktok: /(?:https?:\/\/)?(?:www\.)?tiktok\.com\/@([A-Za-z0-9._]{2,40})/i,
  youtube: /(?:https?:\/\/)?(?:www\.)?youtube\.com\/(?:@|c\/|channel\/|user\/)([A-Za-z0-9._-]{2,60})/i,
};

/** Handles de rede que são NAVEGAÇÃO da própria plataforma, não a empresa. */
const SOCIAL_BLOCKLIST = new Set([
  "sharer", "share", "intent", "plugins", "tr", "dialog", "profile.php",
  "watch", "results", "embed", "login", "policies", "help", "explore",
]);

function pickSocials(html) {
  const out = {};
  for (const [net, re] of Object.entries(SOCIAL_RE)) {
    const m = html.match(re);
    if (!m) continue;
    const handle = String(m[1] || "").toLowerCase();
    if (SOCIAL_BLOCKLIST.has(handle)) continue;
    out[net] = handle;
  }
  return out;
}

/** `<title>` e a meta description — viram a descrição da empresa. */
function pickDescription(html) {
  const meta =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{10,400})["']/i) ||
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{10,400})["']/i);
  if (meta) return meta[1].replace(/\s+/g, " ").trim().slice(0, 400);
  const title = html.match(/<title[^>]*>([^<]{4,200})<\/title>/i);
  return title ? title[1].replace(/\s+/g, " ").trim().slice(0, 200) : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Visita até `maxPages` páginas do domínio e devolve UM `CompanyDraft`.
 *
 * ⚠️ PARA CEDO DE PROPÓSITO: assim que tem WhatsApp E e-mail, não visita mais
 * nada. O que interessa é o canal de contato, e insistir depois de achá-lo só
 * gasta banda de terceiro.
 *
 * ⚠️ A PRIMEIRA PÁGINA QUE RESPONDER VENCE em cada campo. A home tem o rodapé
 * com o contato principal; páginas internas repetem ou trazem variações. Deixar
 * a última sobrescrever faria o e-mail do formulário de RH virar o contato
 * comercial.
 */
async function enrich(company, opts = {}) {
  if (!isConfigured()) return null;
  const domain = company?.domain || N.normalizeDomain(company?.website);
  if (!domain) return null;

  const maxPages = Math.max(1, Math.min(10, Number(opts.maxPages) || 6));
  const origin = `https://${domain}`;

  if (!(await isCrawlAllowed(origin))) {
    log.info("website.robots_disallow", { domain });
    return { fields: {}, source_url: origin, blocked: "robots" };
  }

  const fields = {};
  let visited = 0;
  let sourceUrl = origin;

  for (const path of CANDIDATE_PATHS.slice(0, maxPages)) {
    if (visited >= maxPages) break;
    if (visited > 0) await sleep(POLITE_DELAY_MS);
    const page = await getHtml(`${origin}${path}`);
    visited++;
    if (!page) continue;
    if (visited === 1) sourceUrl = page.finalUrl;

    const html = page.html;
    const put = (k, v) => {
      if (v && !fields[k]) fields[k] = v;
    };

    put("email", pickEmail(html, domain));
    put("whatsapp", pickWhatsapp(html));
    put("phone", pickPhone(html));
    put("cnpj", pickCnpj(html));
    put("description", pickDescription(html));
    for (const [net, handle] of Object.entries(pickSocials(html))) put(net, handle);

    if (fields.whatsapp && fields.email) break;
  }

  // Telefone celular sem WhatsApp declarado É um WhatsApp em potencial — a
  // mesma dedução do OSM, num lugar só de decisão por provider.
  if (!fields.whatsapp && N.isMobilePhone(fields.phone)) fields.whatsapp = fields.phone;

  fields.website = N.normalizeWebsite(origin);
  fields.domain = domain;

  log.info("website.enrich_ok", { domain, pages: visited, got: Object.keys(fields).length });
  return { fields, source_url: sourceUrl, pages: visited };
}

module.exports = {
  source: "website",
  label: "Site oficial",
  capabilities: { discover: false, enrich: true },
  isConfigured,
  enrich,
  // Exportados para o teste: são funções puras sobre HTML, exercitáveis sem rede.
  assertPublicUrl,
  pickEmail,
  pickWhatsapp,
  pickPhone,
  pickCnpj,
  pickSocials,
  pickDescription,
  CANDIDATE_PATHS,
};
