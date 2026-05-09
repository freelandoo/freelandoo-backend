class ManifestationStorage {
  // ---------- Categories ----------

  static async listCategories(conn, { onlyActive = false } = {}) {
    const where = onlyActive ? "WHERE is_active = TRUE" : "";
    const { rows } = await conn.query(
      `SELECT * FROM public.manifestation_categories
       ${where}
       ORDER BY sort_order ASC, name ASC`
    );
    return rows;
  }

  static async getCategoryById(conn, id) {
    const { rows } = await conn.query(
      `SELECT * FROM public.manifestation_categories WHERE id = $1 LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  }

  static async getCategoryBySlug(conn, slug) {
    const { rows } = await conn.query(
      `SELECT * FROM public.manifestation_categories WHERE slug = $1 LIMIT 1`,
      [slug]
    );
    return rows[0] || null;
  }

  static async createCategory(conn, { slug, name, sort_order = 0, is_active = true }) {
    const { rows } = await conn.query(
      `INSERT INTO public.manifestation_categories (slug, name, sort_order, is_active)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [slug, name, sort_order, is_active]
    );
    return rows[0];
  }

  static async updateCategory(conn, id, patch) {
    const allowed = ["slug", "name", "sort_order", "is_active"];
    const fields = [];
    const values = [];
    let i = 1;
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        fields.push(`${key} = $${i++}`);
        values.push(patch[key]);
      }
    }
    if (!fields.length) return this.getCategoryById(conn, id);
    fields.push("updated_at = NOW()");
    values.push(id);
    const { rows } = await conn.query(
      `UPDATE public.manifestation_categories SET ${fields.join(", ")}
       WHERE id = $${i}
       RETURNING *`,
      values
    );
    return rows[0] || null;
  }

  static async deleteCategory(conn, id) {
    const { rowCount } = await conn.query(
      `DELETE FROM public.manifestation_categories WHERE id = $1`,
      [id]
    );
    return rowCount > 0;
  }

  // ---------- Products ----------

  static async listProducts(conn, { onlyActive = false, categoryId = null, limit = null, offset = 0 } = {}) {
    const conds = [];
    const values = [];
    let i = 1;
    if (onlyActive) conds.push("p.is_active = TRUE");
    if (categoryId) {
      conds.push(`p.category_id = $${i++}`);
      values.push(categoryId);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    let sql = `
      SELECT p.*,
             c.slug AS category_slug,
             c.name AS category_name
        FROM public.manifestation_products p
        LEFT JOIN public.manifestation_categories c ON c.id = p.category_id
       ${where}
       ORDER BY p.is_featured DESC, p.sort_order ASC, p.name ASC`;
    if (limit != null) {
      sql += ` LIMIT $${i++} OFFSET $${i++}`;
      values.push(limit, offset);
    }
    const { rows } = await conn.query(sql, values);
    return rows;
  }

  static async getProductById(conn, id) {
    const { rows } = await conn.query(
      `SELECT p.*,
              c.slug AS category_slug,
              c.name AS category_name
         FROM public.manifestation_products p
         LEFT JOIN public.manifestation_categories c ON c.id = p.category_id
        WHERE p.id = $1
        LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  }

  static async getFeaturedProduct(conn) {
    const { rows } = await conn.query(
      `SELECT p.*,
              c.slug AS category_slug,
              c.name AS category_name
         FROM public.manifestation_products p
         LEFT JOIN public.manifestation_categories c ON c.id = p.category_id
        WHERE p.is_featured = TRUE AND p.is_active = TRUE
        LIMIT 1`
    );
    return rows[0] || null;
  }

  static async createProduct(conn, data) {
    const {
      category_id = null,
      name,
      description = null,
      banner_url,
      banner_thumb_url = null,
      tag_label,
      tag_color = "emerald",
      tag_icon = null,
      price_cents = 0,
      price_polens = 0,
      duration_days = 365,
      stock = null,
      is_featured = false,
      is_active = true,
      sort_order = 0,
    } = data;
    const { rows } = await conn.query(
      `INSERT INTO public.manifestation_products
         (category_id, name, description, banner_url, banner_thumb_url,
          tag_label, tag_color, tag_icon,
          price_cents, price_polens, duration_days, stock,
          is_featured, is_active, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        category_id,
        name,
        description,
        banner_url,
        banner_thumb_url,
        tag_label,
        tag_color,
        tag_icon,
        price_cents,
        price_polens,
        duration_days,
        stock,
        is_featured,
        is_active,
        sort_order,
      ]
    );
    return rows[0];
  }

  static async updateProduct(conn, id, patch) {
    const allowed = [
      "category_id",
      "name",
      "description",
      "banner_url",
      "banner_thumb_url",
      "tag_label",
      "tag_color",
      "tag_icon",
      "price_cents",
      "price_polens",
      "duration_days",
      "stock",
      "is_active",
      "sort_order",
    ];
    const fields = [];
    const values = [];
    let i = 1;
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        fields.push(`${key} = $${i++}`);
        values.push(patch[key]);
      }
    }
    if (!fields.length) return this.getProductById(conn, id);
    fields.push("updated_at = NOW()");
    values.push(id);
    const { rows } = await conn.query(
      `UPDATE public.manifestation_products SET ${fields.join(", ")}
       WHERE id = $${i}
       RETURNING *`,
      values
    );
    return rows[0] || null;
  }

  static async deleteProduct(conn, id) {
    // Soft-delete via is_active=false (referenciado por user_manifestations).
    const { rows } = await conn.query(
      `UPDATE public.manifestation_products
          SET is_active = FALSE,
              is_featured = FALSE,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id]
    );
    return rows[0] || null;
  }

  static async setFeatured(conn, id) {
    // Garante apenas 1 destaque ativo (índice parcial UNIQUE protege).
    await conn.query(
      `UPDATE public.manifestation_products
          SET is_featured = FALSE, updated_at = NOW()
        WHERE is_featured = TRUE AND id <> $1`,
      [id]
    );
    const { rows } = await conn.query(
      `UPDATE public.manifestation_products
          SET is_featured = TRUE, updated_at = NOW()
        WHERE id = $1 AND is_active = TRUE
        RETURNING *`,
      [id]
    );
    return rows[0] || null;
  }

  static async unsetFeatured(conn, id) {
    const { rows } = await conn.query(
      `UPDATE public.manifestation_products
          SET is_featured = FALSE, updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id]
    );
    return rows[0] || null;
  }
}

module.exports = ManifestationStorage;
