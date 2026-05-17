class ProductRequestStorage {
  static async create(conn, {
    id_buyer_user, id_product_category, title, description,
    city, state, min_price_cents, max_price_cents,
    reference_image_url, reference_image_key,
  }) {
    const { rows } = await conn.query(
      `INSERT INTO public.tb_product_request
        (id_buyer_user, id_product_category, title, description,
         city, state, min_price_cents, max_price_cents,
         reference_image_url, reference_image_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        id_buyer_user, id_product_category, title, description,
        city, state,
        min_price_cents ?? null, max_price_cents ?? null,
        reference_image_url || null, reference_image_key || null,
      ]
    );
    return rows[0];
  }

  static async getById(conn, id_product_request) {
    const { rows } = await conn.query(
      `SELECT pr.*, pc.name AS category_name, pc.slug AS category_slug
         FROM public.tb_product_request pr
         JOIN public.tb_product_category pc
           ON pc.id_product_category = pr.id_product_category
        WHERE pr.id_product_request = $1
        LIMIT 1`,
      [id_product_request]
    );
    return rows[0] || null;
  }

  static async listByBuyer(conn, id_buyer_user, { limit = 50, offset = 0 } = {}) {
    const { rows } = await conn.query(
      `SELECT pr.*, pc.name AS category_name, pc.slug AS category_slug
         FROM public.tb_product_request pr
         JOIN public.tb_product_category pc
           ON pc.id_product_category = pr.id_product_category
        WHERE pr.id_buyer_user = $1
        ORDER BY pr.created_at DESC
        LIMIT $2 OFFSET $3`,
      [id_buyer_user, limit, offset]
    );
    return rows;
  }

  static async cancel(conn, id_product_request) {
    const { rows } = await conn.query(
      `UPDATE public.tb_product_request
          SET status = 'canceled', canceled_at = NOW(), updated_at = NOW()
        WHERE id_product_request = $1
          AND status IN ('open','answered','negotiating')
        RETURNING *`,
      [id_product_request]
    );
    return rows[0] || null;
  }

  static async close(conn, id_product_request) {
    const { rows } = await conn.query(
      `UPDATE public.tb_product_request
          SET status = 'closed', closed_at = NOW(), updated_at = NOW()
        WHERE id_product_request = $1
          AND status IN ('open','answered','negotiating')
        RETURNING *`,
      [id_product_request]
    );
    return rows[0] || null;
  }

  static async markAnswered(conn, id_product_request) {
    await conn.query(
      `UPDATE public.tb_product_request
          SET status = CASE WHEN status = 'open' THEN 'answered' ELSE status END,
              answered_at = COALESCE(answered_at, NOW()),
              updated_at = NOW()
        WHERE id_product_request = $1`,
      [id_product_request]
    );
  }
}

module.exports = ProductRequestStorage;
