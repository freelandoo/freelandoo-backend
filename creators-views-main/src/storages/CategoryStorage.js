class CategoryStorage {
  static async listCategories(conn, { include_inactive = false } = {}) {
    const r = await conn.query(
      `
      SELECT id_category, desc_category
      FROM public.tb_category
      WHERE ($1::boolean = true) OR (is_active = true)
      ORDER BY desc_category
      `,
      [include_inactive]
    );
    return r.rows;
  }

  static async listSubcategoriesByCategory(
    conn,
    id_category,
    { include_inactive = false } = {}
  ) {
    const r = await conn.query(
      `
      SELECT id_subcategory, id_category, desc_subcategory
      FROM public.tb_subcategory
      WHERE id_category = $1
        AND (($2::boolean = true) OR (is_active = true))
      ORDER BY desc_subcategory
      `,
      [id_category, include_inactive]
    );
    return r.rows;
  }

  // útil pro front (1 chamada só)
  static async listCategoriesWithSubcategories(
    conn,
    { include_inactive = false } = {}
  ) {
    const r = await conn.query(
      `
      SELECT
        c.id_category,
        c.desc_category,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'id_subcategory', s.id_subcategory,
              'desc_subcategory', s.desc_subcategory
            )
            ORDER BY s.desc_subcategory
          ) FILTER (WHERE s.id_subcategory IS NOT NULL),
          '[]'::jsonb
        ) AS subcategories
      FROM public.tb_category c
      LEFT JOIN public.tb_subcategory s
        ON s.id_category = c.id_category
       AND (($1::boolean = true) OR (s.is_active = true))
      WHERE (($1::boolean = true) OR (c.is_active = true))
      GROUP BY c.id_category, c.desc_category
      ORDER BY c.desc_category
      `,
      [include_inactive]
    );
    return r.rows; // cada linha já vem com subcategories (jsonb)
  }
}

module.exports = CategoryStorage;
