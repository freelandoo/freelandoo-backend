// src/storages/MarketReportStorage.js
//
// RELATÓRIO DE MERCADO LOCAL — SQL puro. Quem decide O QUE entra (tipo,
// recorte, o que conta como preço de verdade) é `utils/marketReport`; aqui só
// se agrega.

const { baseSql, shapeStats } = require("../utils/marketReport");

/**
 * A base filtrada pelo texto, quando há. O filtro de nome passa pela MESMA
 * régua de texto do resto do site (`fl_norm_key`, mig 262): "Corte",
 * "corte " e "córte" são o mesmo pedido.
 */
function filteredBase(req, place, params) {
  const base = baseSql(req, place, params);
  if (!req.q) return base;
  params.push(req.q);
  return `SELECT * FROM (${base}) b0
           WHERE public.fl_norm_key(b0.name) LIKE '%' || public.fl_norm_key($${params.length}::text) || '%'`;
}

const STATS = `
  COUNT(*)::int                                             AS count,
  COUNT(DISTINCT owner)::int                                AS providers,
  MIN(price)                                                AS min,
  MAX(price)                                                AS max,
  AVG(price)                                                AS avg,
  percentile_cont(0.25) WITHIN GROUP (ORDER BY price)       AS p25,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY price)       AS median,
  percentile_cont(0.75) WITHIN GROUP (ORDER BY price)       AS p75`;

class MarketReportStorage {
  /** Estatística geral do recorte. */
  static async stats(conn, req, place) {
    const params = [];
    const base = filteredBase(req, place, params);
    const r = await conn.query(`SELECT ${STATS} FROM (${base}) b`, params);
    return shapeStats(r.rows[0]);
  }

  /**
   * O preço por ITEM ("corte", "barba", "corte + barba") — é o que responde
   * "quanto cobram por um corte", em vez de uma mediana que mistura o corte com
   * o combo. Agrupa pelo nome normalizado; o rótulo é a grafia mais comum.
   */
  static async items(conn, req, place, limit = 20) {
    const params = [];
    const base = filteredBase(req, place, params);
    params.push(Math.min(50, Math.max(1, Number(limit) || 20)));
    const r = await conn.query(
      `SELECT public.fl_norm_key(name)                         AS key,
              mode() WITHIN GROUP (ORDER BY name)               AS label,
              ${STATS}
         FROM (${base}) b
        WHERE public.fl_norm_key(name) <> ''
        GROUP BY 1
        ORDER BY COUNT(*) DESC, 2 ASC
        LIMIT $${params.length}::int`,
      params
    );
    return r.rows.map((row) => ({ key: row.key, label: row.label, ...shapeStats(row) }));
  }

  /**
   * A distribuição em faixas, para o gráfico. Oito faixas iguais entre o menor
   * e o maior preço do recorte (`width_bucket`); com um preço só, uma faixa.
   */
  static async histogram(conn, req, place, buckets = 8) {
    const params = [];
    const base = filteredBase(req, place, params);
    params.push(Math.min(20, Math.max(1, Number(buckets) || 8)));
    const n = `$${params.length}::int`;
    const r = await conn.query(
      `WITH b AS (${base}),
            lim AS (SELECT MIN(price) lo, MAX(price) hi FROM b)
       SELECT CASE WHEN lim.hi = lim.lo THEN 1
                   ELSE LEAST(width_bucket(b.price, lim.lo, lim.hi, ${n}), ${n}) END AS bucket,
              MIN(lim.lo) AS lo, MIN(lim.hi) AS hi, COUNT(*)::int AS count
         FROM b CROSS JOIN lim
        GROUP BY 1
        ORDER BY 1`,
      params
    );
    if (!r.rows.length) return [];
    const lo = Number(r.rows[0].lo);
    const hi = Number(r.rows[0].hi);
    const total = Math.min(20, Math.max(1, Number(buckets) || 8));
    const size = hi > lo ? (hi - lo) / total : 0;
    const byBucket = new Map(r.rows.map((row) => [Number(row.bucket), Number(row.count)]));
    const slots = hi > lo ? total : 1;
    return Array.from({ length: slots }, (_, i) => ({
      from: Math.round(lo + size * i),
      to: Math.round(hi > lo ? lo + size * (i + 1) : hi),
      count: byBucket.get(i + 1) || 0,
    }));
  }

  /** Estado e cidade da comunidade — para comparar o recorte com o entorno dela. */
  static async communityPlace(conn, id_community) {
    const r = await conn.query(
      `SELECT id_profile, display_name, estado, municipio, id_region
         FROM public.tb_profile
        WHERE id_profile = $1::uuid AND is_community = TRUE AND deleted_at IS NULL`,
      [id_community]
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      id_community: row.id_profile,
      name: row.display_name,
      uf: row.estado && /^[A-Z]{2}$/.test(row.estado) ? row.estado : null,
      municipio: row.municipio || null,
    };
  }

  static async categoryLabel(conn, id_category) {
    const r = await conn.query(
      `SELECT desc_category FROM public.tb_category WHERE id_category = $1::int`,
      [id_category]
    );
    return r.rows[0]?.desc_category || null;
  }

  static async productCategoryLabel(conn, id_product_category) {
    const r = await conn.query(
      `SELECT name FROM public.tb_product_category WHERE id_product_category = $1::int`,
      [id_product_category]
    );
    return r.rows[0]?.name || null;
  }

  static async regionLabel(conn, id_region) {
    const r = await conn.query(
      `SELECT name, uf FROM public.tb_region WHERE id_region = $1::int`,
      [id_region]
    );
    return r.rows[0] || null;
  }

  /** As comunidades de quem pede — o seletor "na minha comunidade". */
  static async myCommunities(conn, id_user) {
    const r = await conn.query(
      `SELECT p.id_profile, p.display_name, p.community_kind, p.estado, p.municipio
         FROM public.tb_community_member cm
         JOIN public.tb_profile p ON p.id_profile = cm.id_community_profile
        WHERE cm.id_user = $1::uuid AND p.deleted_at IS NULL AND p.is_community = TRUE
        ORDER BY p.display_name ASC
        LIMIT 50`,
      [id_user]
    );
    return r.rows;
  }
}

module.exports = MarketReportStorage;
