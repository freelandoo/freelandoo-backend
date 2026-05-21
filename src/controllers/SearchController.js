const pool = require("../databases");
const SearchService = require("../services/search/SearchService");

class SearchController {
  static async search(req, res) {
    const {
      country,
      estado,
      municipio,
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
        municipio: municipio || null,
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
    const { id_product_category, state, city, q, limit, offset } = req.query;
    const parsedCat = id_product_category != null && id_product_category !== ""
      ? Number(id_product_category) : null;
    const parsedLimit = Math.max(1, Math.min(60, Number(limit) || 30));
    const parsedOffset = Math.max(0, Number(offset) || 0);
    const stateUf = state ? String(state).trim().toUpperCase().slice(0, 2) : null;
    const cityName = city ? String(city).trim().slice(0, 120) : null;
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
    if (cityName) {
      values.push(cityName);
      conditions.push(`p.municipio = $${values.length}`);
    }
    if (search) {
      values.push(`%${search}%`);
      conditions.push(`(pp.name ILIKE $${values.length} OR pp.description ILIKE $${values.length})`);
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
