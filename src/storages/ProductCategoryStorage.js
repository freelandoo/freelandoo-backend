class ProductCategoryStorage {
  static async list(conn, { onlyActive = false } = {}) {
    const where = onlyActive ? "WHERE status = 'active'" : "";
    const { rows } = await conn.query(
      `SELECT * FROM public.tb_product_category
       ${where}
       ORDER BY sort_order ASC, name ASC`
    );
    return rows;
  }

  static async getById(conn, id_product_category) {
    const { rows } = await conn.query(
      `SELECT * FROM public.tb_product_category
        WHERE id_product_category = $1
        LIMIT 1`,
      [id_product_category]
    );
    return rows[0] || null;
  }

  static async getBySlug(conn, slug) {
    const { rows } = await conn.query(
      `SELECT * FROM public.tb_product_category
        WHERE slug = $1
        LIMIT 1`,
      [slug]
    );
    return rows[0] || null;
  }

  static async create(conn, { name, slug, description, icon, parent_id, status, sort_order }) {
    const { rows } = await conn.query(
      `INSERT INTO public.tb_product_category
        (name, slug, description, icon, parent_id, status, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        name,
        slug,
        description || null,
        icon || null,
        parent_id || null,
        status || "active",
        sort_order || 0,
      ]
    );
    return rows[0];
  }

  static async update(conn, id_product_category, patch) {
    const allowed = ["name", "slug", "description", "icon", "parent_id", "status", "sort_order"];
    const fields = [];
    const values = [];
    let i = 1;
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        fields.push(`${key} = $${i++}`);
        values.push(patch[key]);
      }
    }
    if (!fields.length) return this.getById(conn, id_product_category);
    fields.push("updated_at = NOW()");
    values.push(id_product_category);
    const { rows } = await conn.query(
      `UPDATE public.tb_product_category SET ${fields.join(", ")}
        WHERE id_product_category = $${i}
        RETURNING *`,
      values
    );
    return rows[0] || null;
  }

  static async remove(conn, id_product_category) {
    const { rowCount } = await conn.query(
      `DELETE FROM public.tb_product_category WHERE id_product_category = $1`,
      [id_product_category]
    );
    return rowCount > 0;
  }

  static async countProductsByCategory(conn, id_product_category) {
    const { rows } = await conn.query(
      `SELECT COUNT(*)::INT AS total
         FROM public.tb_profile_product
        WHERE id_product_category = $1
          AND deleted_at IS NULL`,
      [id_product_category]
    );
    return rows[0]?.total || 0;
  }
}

module.exports = ProductCategoryStorage;
