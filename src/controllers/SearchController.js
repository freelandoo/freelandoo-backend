const pool = require("../databases");
const SearchService = require("../services/search/SearchService");

class SearchController {
  static async search(req, res) {
    const {
      country,
      estado,
      id_region,
      platform,
      nicho,
      category,
      categories,
      id_machine,
      id_category,
      machine_slug,
      q,
      level_min,
      limit,
      offset,
    } = req.query;

    const parsedIdRegion = id_region != null && id_region !== "" ? Number(id_region) : null;

    // Normaliza country: ISO-2 maiúsculo. "all" desliga o filtro (NULL).
    let normalizedCountry = null;
    if (country && country !== "all") {
      const c = String(country).trim().toUpperCase();
      if (c.length === 2) normalizedCountry = c;
    }

    const parsedCategories = Array.isArray(categories)
      ? categories.filter(Boolean)
      : typeof categories === "string" && categories.trim() !== ""
        ? categories.split(",").map((s) => s.trim()).filter(Boolean)
        : null;

    const parsedIdMachine = id_machine != null && id_machine !== "" ? Number(id_machine) : null;
    const parsedIdCategory = id_category != null && id_category !== "" ? Number(id_category) : null;
    const parsedLevelMin = level_min != null && level_min !== "" ? Number(level_min) : null;

    const data = await SearchService.execute({
      db: pool,
      filters: {
        country: normalizedCountry,
        estado: estado || null,
        id_region: Number.isFinite(parsedIdRegion) ? parsedIdRegion : null,
        platform: platform || null,
        nicho: nicho || null,
        category: category || null,
        categories: parsedCategories,
        id_machine: Number.isFinite(parsedIdMachine) ? parsedIdMachine : null,
        id_category: Number.isFinite(parsedIdCategory) ? parsedIdCategory : null,
        machine_slug: machine_slug || null,
        q: q || null,
        level_min: Number.isFinite(parsedLevelMin) ? parsedLevelMin : null,
      },
      pagination: {
        limit: limit ? Number(limit) : 20,
        offset: offset ? Number(offset) : 0,
      },
    });

    return res.status(200).json(data);
  }

  // ---------------------------------------------------------------------------
  // Busca pública de produtos da Loja — filtros: categoria, estado, cidade, q.
  // ---------------------------------------------------------------------------
  static async searchProducts(req, res) {
    const { id_product_category, state, id_region, q, limit, offset } = req.query;
    const parsedCat = id_product_category != null && id_product_category !== ""
      ? Number(id_product_category) : null;
    const parsedLimit = Math.max(1, Math.min(60, Number(limit) || 30));
    const parsedOffset = Math.max(0, Number(offset) || 0);
    const stateUf = state ? String(state).trim().toUpperCase().slice(0, 2) : null;
    const parsedRegion = id_region != null && id_region !== "" ? Number(id_region) : null;
    const search = q ? String(q).trim().slice(0, 80) : null;

    const conditions = ["pp.is_active = TRUE", "pp.deleted_at IS NULL", "pp.stock_quantity > 0"];
    const values = [];
    if (Number.isFinite(parsedCat) && parsedCat > 0) {
      values.push(parsedCat);
      conditions.push(`pp.id_product_category = $${values.length}`);
    }
    if (stateUf && stateUf.length === 2) {
      values.push(stateUf);
      conditions.push(`p.estado = $${values.length}`);
    }
    // Região agregada: filtra pelo perfil dono (p.id_region).
    if (Number.isFinite(parsedRegion) && parsedRegion > 0) {
      values.push(parsedRegion);
      conditions.push(`p.id_region = $${values.length}`);
    }
    if (search) {
      values.push(`%${search}%`);
      conditions.push(`(pp.name ILIKE $${values.length} OR pp.description ILIKE $${values.length})`);
    }

    // ── Faixa de preço (centavos) ────────────────────────────────────────────
    const priceMin = Number(req.query.price_min);
    const priceMax = Number(req.query.price_max);
    if (Number.isInteger(priceMin) && priceMin > 0) {
      values.push(priceMin);
      conditions.push(`pp.price_amount >= $${values.length}`);
    }
    if (Number.isInteger(priceMax) && priceMax > 0) {
      values.push(priceMax);
      conditions.push(`pp.price_amount <= $${values.length}`);
    }

    // ── Subfiltros por atributo (mig 139) ────────────────────────────────────
    //   attr_<chave>=v1,v2        → produto tem qualquer um dos valores
    //   attr_<chave>_min/_max     → faixa numérica sobre os valores (ex.: tamanho)
    //   attr_brand=texto          → match parcial case-insensitive
    // Chaves restritas a [a-z0-9_] e tudo parametrizado (sem interpolação).
    const ATTR_RANGE_RE = /^attr_([a-z0-9_]{1,40})_(min|max)$/;
    const ATTR_KEY_RE = /^attr_([a-z0-9_]{1,40})$/;
    const attrRanges = new Map();
    let attrConditions = 0;
    for (const [rawKey, rawVal] of Object.entries(req.query)) {
      if (attrConditions >= 12) break;
      const val = Array.isArray(rawVal) ? rawVal[0] : rawVal;
      if (val == null || val === "") continue;

      const rangeMatch = ATTR_RANGE_RE.exec(rawKey);
      if (rangeMatch) {
        const num = Number(String(val).replace(",", "."));
        if (!Number.isFinite(num)) continue;
        const entry = attrRanges.get(rangeMatch[1]) || {};
        entry[rangeMatch[2]] = num;
        attrRanges.set(rangeMatch[1], entry);
        continue;
      }

      const keyMatch = ATTR_KEY_RE.exec(rawKey);
      if (!keyMatch) continue;
      const key = keyMatch[1];

      if (key === "brand") {
        values.push(`%${String(val).trim().slice(0, 80)}%`);
        conditions.push(`pp.attributes->>'brand' ILIKE $${values.length}`);
        attrConditions += 1;
        continue;
      }

      const vals = String(val)
        .split(",")
        .map((s) => s.trim().slice(0, 80))
        .filter(Boolean)
        .slice(0, 20);
      if (vals.length === 0) continue;
      values.push(key);
      const kIdx = values.length;
      values.push(vals);
      const vIdx = values.length;
      conditions.push(`(
        (jsonb_typeof(pp.attributes->$${kIdx}::text) = 'array' AND pp.attributes->$${kIdx}::text ?| $${vIdx}::text[])
        OR (pp.attributes->>$${kIdx}::text = ANY($${vIdx}::text[]))
      )`);
      attrConditions += 1;
    }

    // Faixas numéricas: pelo menos UM valor do array dentro de [min, max].
    for (const [key, range] of attrRanges) {
      if (attrConditions >= 12) break;
      values.push(key);
      const kIdx = values.length;
      const bounds = [];
      if (range.min != null) {
        values.push(range.min);
        bounds.push(`REPLACE(el, ',', '.')::numeric >= $${values.length}`);
      }
      if (range.max != null) {
        values.push(range.max);
        bounds.push(`REPLACE(el, ',', '.')::numeric <= $${values.length}`);
      }
      if (bounds.length === 0) continue;
      conditions.push(`(
        jsonb_typeof(pp.attributes->$${kIdx}::text) = 'array' AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(pp.attributes->$${kIdx}::text) el
          WHERE el ~ '^[0-9]+([.,][0-9]+)?$' AND ${bounds.join(" AND ")}
        )
      )`);
      attrConditions += 1;
    }

    values.push(parsedLimit);
    values.push(parsedOffset);

    const sql = `
      SELECT
        pp.id_profile_product,
        pp.id_profile,
        pp.name,
        pp.description,
        pp.price_amount,
        pp.currency,
        pp.stock_quantity,
        pp.attributes,
        pp.id_product_category,
        pc.name AS category_name,
        p.display_name AS profile_display_name,
        p.sub_profile_slug,
        p.estado,
        p.municipio,
        u.username,
        (SELECT media_url FROM public.tb_profile_product_media m
          WHERE m.id_profile_product = pp.id_profile_product
          ORDER BY sort_order ASC, id_product_media ASC LIMIT 1) AS thumb_url
      FROM public.tb_profile_product pp
      JOIN public.tb_profile p ON p.id_profile = pp.id_profile
      JOIN public.tb_user u ON u.id_user = p.id_user
      LEFT JOIN public.tb_product_category pc ON pc.id_product_category = pp.id_product_category
      WHERE ${conditions.join(" AND ")}
        AND p.is_visible = TRUE
        AND p.deleted_at IS NULL
      ORDER BY pp.created_at DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}
    `;

    const r = await pool.query(sql, values);
    return res.status(200).json({ items: r.rows });
  }

  // ---------------------------------------------------------------------------
  // Busca pública de cursos publicados — filtros: enxame, profissão, q.
  // ---------------------------------------------------------------------------
  static async searchCourses(req, res) {
    const { id_machine, id_category, q, limit, offset } = req.query;
    const parsedMachine = id_machine != null && id_machine !== "" ? Number(id_machine) : null;
    const parsedCategory = id_category != null && id_category !== "" ? Number(id_category) : null;
    const parsedLimit = Math.max(1, Math.min(60, Number(limit) || 30));
    const parsedOffset = Math.max(0, Number(offset) || 0);
    const search = q ? String(q).trim().slice(0, 80) : null;

    const conditions = ["cs.status = 'published'", "p.deleted_at IS NULL"];
    const values = [];
    if (Number.isFinite(parsedMachine) && parsedMachine > 0) {
      values.push(parsedMachine);
      conditions.push(`c.id_machine = $${values.length}`);
    }
    if (Number.isFinite(parsedCategory) && parsedCategory > 0) {
      values.push(parsedCategory);
      conditions.push(`p.id_category = $${values.length}`);
    }
    if (search) {
      values.push(`%${search}%`);
      conditions.push(`(cs.title ILIKE $${values.length} OR cs.short_description ILIKE $${values.length})`);
    }
    values.push(parsedLimit);
    values.push(parsedOffset);

    const sql = `
      SELECT
        cs.id,
        cs.title,
        cs.slug,
        cs.short_description,
        cs.cover_url,
        cs.price_cents,
        cs.profile_id,
        cs.published_at,
        p.display_name AS profile_display_name,
        p.sub_profile_slug,
        u.username,
        c.id_machine,
        c.id_category,
        c.desc_category AS category_name,
        m.name AS machine_name,
        m.color_accent AS machine_accent
      FROM public.courses cs
      JOIN public.tb_profile p ON p.id_profile = cs.profile_id
      JOIN public.tb_user u ON u.id_user = p.id_user
      LEFT JOIN public.tb_category c ON c.id_category = p.id_category
      LEFT JOIN public.tb_machine m ON m.id_machine = c.id_machine
      WHERE ${conditions.join(" AND ")}
      ORDER BY cs.published_at DESC NULLS LAST, cs.created_at DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}
    `;

    const r = await pool.query(sql, values);
    return res.status(200).json({ items: r.rows });
  }
}

module.exports = SearchController;
