class ProductRequestResponseStorage {
  static async create(conn, {
    id_product_request, id_seller_user, id_profile, id_profile_product,
    message, proposed_price_cents,
  }) {
    const { rows } = await conn.query(
      `INSERT INTO public.tb_product_request_response
        (id_product_request, id_seller_user, id_profile, id_profile_product,
         message, proposed_price_cents)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id_product_request, id_profile) DO UPDATE
         SET message = EXCLUDED.message,
             proposed_price_cents = EXCLUDED.proposed_price_cents,
             id_profile_product = EXCLUDED.id_profile_product,
             status = CASE
               WHEN tb_product_request_response.status IN ('rejected','canceled')
                 THEN tb_product_request_response.status
               ELSE 'sent'
             END,
             updated_at = NOW()
       RETURNING *`,
      [
        id_product_request, id_seller_user, id_profile,
        id_profile_product || null,
        message,
        proposed_price_cents ?? null,
      ]
    );
    return rows[0];
  }

  static async getByPair(conn, id_product_request, id_profile) {
    const { rows } = await conn.query(
      `SELECT * FROM public.tb_product_request_response
        WHERE id_product_request = $1 AND id_profile = $2
        LIMIT 1`,
      [id_product_request, id_profile]
    );
    return rows[0] || null;
  }

  static async listByRequest(conn, id_product_request) {
    const { rows } = await conn.query(
      `SELECT prr.*,
              p.display_name, p.avatar_url, p.sub_profile_slug,
              pp.name AS suggested_product_name, pp.price_amount AS suggested_product_price
         FROM public.tb_product_request_response prr
         JOIN public.tb_profile p ON p.id_profile = prr.id_profile
    LEFT JOIN public.tb_profile_product pp ON pp.id_profile_product = prr.id_profile_product
        WHERE prr.id_product_request = $1
        ORDER BY prr.created_at DESC`,
      [id_product_request]
    );
    return rows;
  }

  static async countByRequest(conn, id_product_request) {
    const { rows } = await conn.query(
      `SELECT COUNT(*)::INT AS total
         FROM public.tb_product_request_response
        WHERE id_product_request = $1
          AND status != 'canceled'`,
      [id_product_request]
    );
    return rows[0]?.total || 0;
  }
}

module.exports = ProductRequestResponseStorage;
