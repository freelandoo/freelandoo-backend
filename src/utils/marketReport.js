/**
 * RELATÓRIO DE MERCADO LOCAL — as regras puras (2026-09-28).
 *
 * Pedido do Alex: "vamos criar a maneira de registrar e organizar serviços e
 * produtos em regiões e comunidades, para que exista um indicador para sabermos
 * quanto barbeiros estão cobrando na minha região, por exemplo".
 *
 * ─── NÃO EXISTE CADASTRO NOVO ───────────────────────────────────────────────
 * Os preços JÁ estão registrados, cada um com lugar:
 *   - serviço  → tb_profile_service  (profissão = categoria do PERFIL, e o
 *                perfil tem estado, cidade e região)
 *   - produto  → tb_profile_product  (categoria do produto, mig 069)
 *   - vitrine  → tb_condo_listing    (anúncio de morador; o lugar é o da
 *                COMUNIDADE onde ele está)
 * Uma tabela "de preços de mercado" seria a segunda verdade sobre o mesmo
 * número — o barbeiro mudaria o preço no perfil e o indicador continuaria
 * dizendo o antigo. O relatório LÊ a fonte, e o que ele organiza é o recorte.
 *
 * ─── O RECORTE É UM SÓ POR VEZ ───────────────────────────────────────────────
 * comunidade > cidade > região > estado > país. O mais estreito informado
 * vence, e os mais largos voltam como COMPARAÇÃO ("no seu bairro R$40, no
 * estado R$45") — é a comparação que transforma um número em indicador.
 *
 * ⚠️ OS FILTROS SÃO FRAGMENTOS ESCOLHIDOS AQUI, COM PARÂMETROS NUMERADOS NA
 * ORDEM EM QUE ENTRAM. Parâmetro que não aparece no SQL derruba a consulta
 * ("could not determine data type of parameter"), e o mesmo parâmetro em dois
 * contextos de tipo é o 42P08 que já custou as migs 202–204.
 */

const KINDS = Object.freeze(["service", "product", "listing"]);
const LEVELS = Object.freeze(["community", "city", "region", "state", "country"]);

const UF_RE = /^[A-Z]{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanText(v, max) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

function positiveInt(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Lê a querystring e devolve o pedido normalizado — ou `{ error }`.
 * Nunca confia no cliente: UF é duas letras, comunidade é UUID, ids são
 * inteiros positivos. O que não passa vira ausência, não erro (um filtro torto
 * alarga o recorte em vez de derrubar a tela), exceto o `kind`.
 */
function parseRequest(query = {}) {
  const kind = KINDS.includes(query.kind) ? query.kind : "service";
  const uf = cleanText(query.uf, 2)?.toUpperCase() || null;
  const req = {
    kind,
    // Vitrine: 'service' ou 'product' do anúncio.
    listing_kind: query.listing_kind === "product" ? "product" : "service",
    id_category: positiveInt(query.id_category),
    id_product_category: positiveInt(query.id_product_category),
    uf: uf && UF_RE.test(uf) ? uf : null,
    municipio: cleanText(query.municipio, 160),
    id_region: positiveInt(query.id_region),
    id_community: query.id_community && UUID_RE.test(String(query.id_community)) ? String(query.id_community) : null,
    q: cleanText(query.q, 80),
  };
  // Cidade sem estado é ambígua (há Campinas em SP e no RJ): cai para o estado.
  if (req.municipio && !req.uf) req.municipio = null;
  return req;
}

/** O recorte mais estreito que o pedido informa. */
function levelOf(req) {
  if (req.id_community) return "community";
  if (req.municipio && req.uf) return "city";
  if (req.id_region) return "region";
  if (req.uf) return "state";
  return "country";
}

/**
 * Os recortes mais largos, para comparação. Comunidade compara com a cidade e o
 * estado DELA (resolvidos pelo chamador em `communityPlace`).
 */
function compareLevels(level, req, communityPlace) {
  const out = [];
  const uf = req.uf || communityPlace?.uf || null;
  const municipio = req.municipio || communityPlace?.municipio || null;
  if (level === "community" && uf && municipio) out.push({ level: "city", uf, municipio });
  if ((level === "community" || level === "city" || level === "region") && uf) out.push({ level: "state", uf });
  if (level !== "country") out.push({ level: "country" });
  return out;
}

/**
 * Monta a cláusula de LUGAR para um recorte, empurrando os valores em `params`.
 *
 * @param {"p"|"c"} alias tabela que tem estado/município/região (o perfil, ou a
 *   comunidade no caso da vitrine).
 * @param {string} userCol coluna do dono do preço, para o recorte de comunidade.
 */
function placeSql({ level, uf, municipio, id_region, id_community }, params, alias, userCol) {
  const p = () => `$${params.length}`;
  switch (level) {
    case "community":
      if (alias === "c") {
        params.push(id_community);
        return `c.id_profile = ${p()}::uuid`;
      }
      params.push(id_community);
      return `${userCol} IN (SELECT cm.id_user FROM public.tb_community_member cm WHERE cm.id_community_profile = ${p()}::uuid)`;
    case "city": {
      params.push(uf);
      const a = p();
      params.push(municipio);
      return `${alias}.estado = ${a}::text AND public.fl_norm_key(${alias}.municipio) = public.fl_norm_key(${p()}::text)`;
    }
    case "region":
      params.push(id_region);
      return `${alias}.id_region = ${p()}::int`;
    case "state":
      params.push(uf);
      return `${alias}.estado = ${p()}::text`;
    default:
      return "TRUE";
  }
}

/**
 * O SELECT da base (um preço por linha, com o nome e o dono) para o tipo pedido.
 * Tudo que não tem preço de verdade fica fora: preço zero, "sob orçamento",
 * inativo, apagado, e — no perfil-conta — a categoria FANTASMA (mig 200), que
 * poria preços na profissão errada.
 */
function baseSql(req, place, params) {
  if (req.kind === "product") {
    const where = [
      "pr.deleted_at IS NULL",
      "pr.is_active = TRUE",
      "pr.price_amount > 0",
      "p.deleted_at IS NULL",
      "COALESCE(p.is_community, FALSE) = FALSE",
    ];
    if (req.id_product_category) {
      params.push(req.id_product_category);
      where.push(`pr.id_product_category = $${params.length}::int`);
    }
    where.push(placeSql(place, params, "p", "p.id_user"));
    return `SELECT pr.name AS name, pr.price_amount AS price, p.id_user AS owner
              FROM public.tb_profile_product pr
              JOIN public.tb_profile p ON p.id_profile = pr.id_profile
             WHERE ${where.join(" AND ")}`;
  }

  if (req.kind === "listing") {
    const where = [
      "l.status = 'active'",
      "l.paid_until > NOW()",
      "COALESCE(l.price_cents, 0) > 0",
      "c.deleted_at IS NULL",
    ];
    params.push(req.listing_kind);
    where.push(`l.kind = $${params.length}::text`);
    where.push(placeSql(place, params, "c", "l.id_user"));
    return `SELECT l.title AS name, l.price_cents AS price, l.id_user AS owner
              FROM public.tb_condo_listing l
              JOIN public.tb_profile c ON c.id_profile = l.id_condo
             WHERE ${where.join(" AND ")}`;
  }

  const where = [
    "s.deleted_at IS NULL",
    "s.is_active = TRUE",
    "COALESCE(s.price_on_request, FALSE) = FALSE",
    "s.price_amount > 0",
    "p.deleted_at IS NULL",
    "COALESCE(p.is_community, FALSE) = FALSE",
    "NOT (p.is_user_account AND p.taxonomy_declared_at IS NULL)",
  ];
  if (req.id_category) {
    params.push(req.id_category);
    where.push(`p.id_category = $${params.length}::int`);
  }
  where.push(placeSql(place, params, "p", "p.id_user"));
  return `SELECT s.name AS name, s.price_amount AS price, p.id_user AS owner
            FROM public.tb_profile_service s
            JOIN public.tb_profile p ON p.id_profile = s.id_profile
           WHERE ${where.join(" AND ")}`;
}

/** Abaixo disto a tela avisa: com poucos preços, a mediana é a de uma pessoa. */
const LOW_SAMPLE = 5;

function num(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** Linha de estatística do banco → forma da API (centavos inteiros). */
function shapeStats(row) {
  const count = Number(row?.count) || 0;
  return {
    count,
    providers: Number(row?.providers) || 0,
    min: count ? num(row.min) : null,
    p25: count ? num(row.p25) : null,
    median: count ? num(row.median) : null,
    avg: count ? num(row.avg) : null,
    p75: count ? num(row.p75) : null,
    max: count ? num(row.max) : null,
    low_sample: count > 0 && count < LOW_SAMPLE,
  };
}

module.exports = {
  KINDS,
  LEVELS,
  LOW_SAMPLE,
  parseRequest,
  levelOf,
  compareLevels,
  placeSql,
  baseSql,
  shapeStats,
};
