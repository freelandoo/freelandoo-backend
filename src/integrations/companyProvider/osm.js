// src/integrations/companyProvider/osm.js
// OpenStreetMap (Overpass + Nominatim) — a fonte de DESCOBERTA.
//
// ⚠️ É ELA QUE RESPONDE "ACADEMIAS EM SÃO BERNARDO", e é por isso que ela é a
// primeira. A base de CNPJ da Receita, que seria o palpite óbvio, NÃO sabe
// responder isso: não tem coordenada, o CNAE descreve a atividade declarada
// (não a placa na porta) e não há como perguntar "o que existe perto daqui".
// O OSM tem o estabelecimento FÍSICO, com nome, categoria e coordenada.
//
// ⚠️ NÃO É SCRAPING DO GOOGLE MAPS, e isso é decisão registrada: o pedido
// proíbe, e a plataforma não implementa nada que contorne CAPTCHA, termos ou
// autenticação de terceiro. O OSM é ODbL e a Overpass é uma API pública de
// consulta.
//
// ─── A CORTESIA COM UM SERVIÇO PÚBLICO E GRATUITO ───────────────────────────
//
// A Overpass e o Nominatim são bancados por doação. Bater neles sem freio é
// como se perde acesso a eles — e o sintoma seria a feature inteira parar sem
// que ninguém tivesse mexido em código. Por isso:
//
//   · a descoberta só roda no WORKER, nunca numa requisição HTTP;
//   · o dedupe da fila garante UMA varredura por (categoria, cidade) viva;
//   · o TTL (`discovery_ttl_hours`, 7 dias) impede revarrer o que é recente;
//   · o resultado da área do Nominatim é CACHEADO para sempre em
//     `tb_osm_area_cache` — o polígono de um município não muda;
//   · User-Agent identificando a plataforma e um contato, como a política pede.

const { createLogger } = require("../../utils/logger");
const { getCategory, categoryFromOsmTags } = require("../../utils/companyCategories");
const N = require("../../utils/companyNormalize");

const log = createLogger("companyProvider.osm");

const OVERPASS = process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";
const NOMINATIM = process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org";
const UA = "Freelandoo/1.0 (+https://www.freelandoo.com.br; alex.rodriguus@gmail.com)";

// Overpass é lenta por natureza — uma cidade grande leva dezenas de segundos.
// O teto é generoso porque isto roda no worker, sem ninguém esperando na tela.
const OVERPASS_TIMEOUT_MS = 90_000;
const NOMINATIM_TIMEOUT_MS = 12_000;

/**
 * ⚠️ O OSM NÃO PRECISA DE CHAVE, ENTÃO ELE ESTÁ SEMPRE CONFIGURADO.
 *
 * O ambiente ainda pode DESLIGÁ-LO (`OSM_DISCOVERY=off`) — é a válvula para o
 * dia em que a Overpass estiver fora do ar ou nos bloquear: a fonte some da
 * lista e a tela diz "descoberta indisponível" em vez de enfileirar trabalho
 * que vai falhar em série.
 */
function isConfigured() {
  return String(process.env.OSM_DISCOVERY || "on").toLowerCase() !== "off";
}

async function getJson(url, { timeout, body } = {}) {
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body,
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) {
    log.warn("osm.http_error", { url, status: res.status });
    return null;
  }
  return res.json();
}

/**
 * (uf, cidade) → id da ÁREA no Overpass.
 *
 * ⚠️ POR QUE NÃO CONSULTAR A ÁREA PELO NOME DIRETO NO OVERPASS. Porque nome de
 * município no Brasil é ambíguo: `area["name"="São Bernardo do Campo"]` casa
 * também com São Bernardo/MA, e a busca de SP responderia com empresas do
 * Maranhão — sem erro nenhum, só com o resultado errado. O Nominatim resolve
 * (cidade, estado, país) para UM `osm_id`, e daí em diante o Overpass é
 * consultado por ID, que não é ambíguo.
 *
 * ⚠️ A CONVERSÃO `3600000000 + osm_id` NÃO É MÁGICA: é como a Overpass
 * endereça áreas derivadas de RELAÇÕES (que é o que um município é). Para um
 * `way` o offset seria 2400000000 — por isso o filtro `osm_type=relation`
 * abaixo; sem ele, um resultado do tipo `way` produziria um id de área que não
 * existe e a varredura voltaria vazia.
 */
async function resolveAreaId({ uf, city }) {
  const q = new URLSearchParams({
    q: `${city}, ${uf}, Brasil`,
    format: "jsonv2",
    limit: "5",
    countrycodes: "br",
    addressdetails: "1",
  });
  const json = await getJson(`${NOMINATIM}/search?${q}`, { timeout: NOMINATIM_TIMEOUT_MS });
  if (!Array.isArray(json)) return null;
  // Só RELATION serve: o offset 3600000000 é o de relação, e um resultado do
  // tipo `node` (o ponto da sede da prefeitura, que o Nominatim às vezes
  // devolve primeiro) produziria um id de área inexistente — a varredura
  // voltaria vazia sem erro nenhum.
  const rel = json.find((r) => r.osm_type === "relation");
  if (!rel?.osm_id) return null;
  return {
    osm_area_id: 3600000000 + Number(rel.osm_id),
    display_name: rel.display_name || null,
  };
}

/**
 * Monta a Overpass QL.
 *
 * `nwr` cobre node, way e relation: uma academia pequena é um ponto, um shopping
 * é um polígono. Só `node` deixaria de fora justamente os estabelecimentos
 * grandes. `out center` devolve o centroide do polígono, que é a coordenada que
 * a tela precisa.
 */
function buildQuery({ areaId, category, limit }) {
  const cat = getCategory(category);
  if (!cat) return null;
  const clauses = cat.osm
    .map(([k, v]) => `  nwr["${k}"="${v}"](area.a);`)
    .join("\n");
  return `[out:json][timeout:${Math.floor(OVERPASS_TIMEOUT_MS / 1000)}];
area(${areaId})->.a;
(
${clauses}
);
out center tags ${Math.max(1, Math.min(2000, Number(limit) || 400))};`;
}

/**
 * A que rede pertence uma URL — ou `null` se ela é mesmo um site.
 *
 * ⚠️ NO BRASIL, MUITO COMÉRCIO **SÓ TEM INSTAGRAM**, e o mapeador põe o perfil
 * na tag `website` porque é ali que cabe. Gravando isso como site, três coisas
 * quebram de uma vez, todas em silêncio: a empresa some do filtro "com
 * Instagram" (que é justamente por onde ela é abordável), entra no filtro "com
 * site" prometendo um site que não existe, e o crawler é mandado ao
 * instagram.com — que responde login/robots, gasta a vaga de páginas do teto e
 * ainda volta marcado como bloqueado na ficha.
 */
const SOCIAL_HOSTS = [
  ["instagram", "instagram.com"],
  ["facebook", "facebook.com"],
  ["facebook", "fb.com"],
  ["linkedin", "linkedin.com"],
  ["tiktok", "tiktok.com"],
  ["youtube", "youtube.com"],
  ["youtube", "youtu.be"],
];

function socialNetworkOf(url) {
  const host = N.normalizeDomain(url);
  if (!host) return null;
  const hit = SOCIAL_HOSTS.find(([, h]) => host === h || host.endsWith(`.${h}`));
  return hit ? hit[0] : null;
}

/** `wa.me/55...` e `api.whatsapp.com/send?phone=55...` são TELEFONE, não site. */
function whatsappFromUrl(url) {
  const host = N.normalizeDomain(url);
  if (!host) return null;
  if (!/(^|\.)(wa\.me|api\.whatsapp\.com|whatsapp\.com)$/.test(host)) return null;
  const digits = String(url).replace(/^https?:\/\//i, "").replace(/\D/g, "");
  return N.normalizePhone(digits);
}

/**
 * Um elemento cru do Overpass vira um `CompanyDraft`.
 *
 * ⚠️ SEM NOME NÃO VIRA EMPRESA. O OSM está cheio de pontos mapeados sem `name`
 * (alguém marcou "tem uma academia aqui" e não soube o nome). Eles são dado
 * geográfico legítimo e lead nenhum: entrariam na tela como uma linha em
 * branco que o vendedor não tem como abordar.
 */
function toDraft(el) {
  const tags = el?.tags || {};
  const name = String(tags.name || "").trim();
  if (!name) return null;

  const lat = el.lat ?? el.center?.lat ?? null;
  const lon = el.lon ?? el.center?.lon ?? null;

  const rawSite = N.normalizeWebsite(
    tags.website || tags["contact:website"] || tags.url || null
  );
  // O que veio na tag `website` pode não ser um site: roteia para o campo que
  // a coisa realmente é, em vez de gravar errado num campo que parece certo.
  const siteNetwork = socialNetworkOf(rawSite);
  const siteWhatsapp = whatsappFromUrl(rawSite);
  const website = siteNetwork || siteWhatsapp ? null : rawSite;
  // O OSM tem DOIS lugares para telefone, e projetos diferentes usam um ou
  // outro. Ler só `phone` perderia metade dos contatos.
  const phone = N.normalizePhone(tags.phone || tags["contact:phone"] || null);
  const whatsRaw = tags["contact:whatsapp"] || tags.whatsapp || null;

  const number = String(tags["addr:housenumber"] || "").trim() || null;
  const street = String(tags["addr:street"] || "").trim() || null;

  const fields = {
    display_name: name,
    trade_name: name,
    category_key: categoryFromOsmTags(tags),
    latitude: lat === null ? null : Number(lat),
    longitude: lon === null ? null : Number(lon),
    address: street,
    address_number: number,
    neighborhood: String(tags["addr:suburb"] || tags["addr:neighbourhood"] || "").trim() || null,
    city: String(tags["addr:city"] || "").trim() || null,
    uf: String(tags["addr:state"] || "").trim().toUpperCase().slice(0, 2) || null,
    zip_code: N.normalizeZip(tags["addr:postcode"]),
    website,
    domain: N.normalizeDomain(website),
    email: N.normalizeEmail(tags.email || tags["contact:email"] || null),
    phone,
    // WhatsApp declarado vence a dedução; sem ele, um telefone que é celular
    // É um WhatsApp em potencial — e é assim que o filtro "com WhatsApp" fica
    // útil num país onde quase todo comércio atende por ele.
    whatsapp:
      N.normalizePhone(whatsRaw) ||
      siteWhatsapp ||
      (N.isMobilePhone(phone) ? phone : null),
    // A tag dedicada vence a URL achada em `website` — quem escreveu
    // `contact:instagram` estava respondendo exatamente esta pergunta.
    instagram:
      N.normalizeSocialHandle(tags["contact:instagram"] || tags.instagram, "instagram") ||
      (siteNetwork === "instagram" ? N.normalizeSocialHandle(rawSite, "instagram") : null),
    facebook:
      N.normalizeSocialHandle(tags["contact:facebook"] || tags.facebook, "facebook") ||
      (siteNetwork === "facebook" ? N.normalizeSocialHandle(rawSite, "facebook") : null),
    linkedin:
      N.normalizeSocialHandle(tags["contact:linkedin"] || tags.linkedin, "linkedin") ||
      (siteNetwork === "linkedin" ? N.normalizeSocialHandle(rawSite, "linkedin") : null),
    tiktok:
      N.normalizeSocialHandle(tags["contact:tiktok"] || tags.tiktok, "tiktok") ||
      (siteNetwork === "tiktok" ? N.normalizeSocialHandle(rawSite, "tiktok") : null),
    youtube:
      N.normalizeSocialHandle(tags["contact:youtube"] || tags.youtube, "youtube") ||
      (siteNetwork === "youtube" ? N.normalizeSocialHandle(rawSite, "youtube") : null),
    // ⚠️ O OSM GUARDA CNPJ EM `ref:vatin`, no formato "BR12345678000190".
    // Ele é raro, e é ouro quando existe: economiza a etapa inteira de
    // descobrir o CNPJ para enriquecer pela Receita.
    cnpj: N.normalizeCnpj(String(tags["ref:vatin"] || "").replace(/^BR/i, "")),
  };

  return {
    fields,
    source_url: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    osm_ref: `${el.type}/${el.id}`,
  };
}

/**
 * Descobre estabelecimentos de uma categoria numa cidade.
 *
 * `areaId` vem resolvido de fora (o service cuida do cache) — este módulo não
 * fala com o banco, o que o mantém testável e substituível.
 */
async function discover({ areaId, category, limit }) {
  if (!isConfigured()) return [];
  const ql = buildQuery({ areaId, category, limit });
  if (!ql) return [];
  try {
    const json = await getJson(OVERPASS, {
      timeout: OVERPASS_TIMEOUT_MS,
      body: new URLSearchParams({ data: ql }).toString(),
    });
    const elements = Array.isArray(json?.elements) ? json.elements : [];
    const drafts = [];
    for (const el of elements) {
      const d = toDraft(el);
      if (d) drafts.push(d);
    }
    log.info("osm.discover_ok", { category, areaId, found: drafts.length, raw: elements.length });
    return drafts;
  } catch (err) {
    log.warn("osm.discover_fail", { category, areaId, message: err?.message });
    return [];
  }
}

/**
 * Re-lê UM elemento do OSM para atualizar o que mudou nele.
 *
 * É o caminho barato de manutenção: pergunta por um id específico em vez de
 * revarrer a cidade inteira.
 */
async function enrich(company) {
  if (!isConfigured() || !company?.osm_ref) return null;
  const [type, id] = String(company.osm_ref).split("/");
  if (!["node", "way", "relation"].includes(type) || !/^\d+$/.test(String(id))) return null;
  try {
    const json = await getJson(OVERPASS, {
      timeout: NOMINATIM_TIMEOUT_MS,
      body: new URLSearchParams({
        data: `[out:json][timeout:20];${type}(${id});out center tags 1;`,
      }).toString(),
    });
    const el = Array.isArray(json?.elements) ? json.elements[0] : null;
    return el ? toDraft(el) : null;
  } catch (err) {
    log.warn("osm.enrich_fail", { osm_ref: company.osm_ref, message: err?.message });
    return null;
  }
}

module.exports = {
  source: "osm",
  label: "OpenStreetMap",
  capabilities: { discover: true, enrich: true },
  isConfigured,
  resolveAreaId,
  discover,
  enrich,
  // Exportado para o teste conferir a QL sem bater na rede.
  buildQuery,
  toDraft,
};
