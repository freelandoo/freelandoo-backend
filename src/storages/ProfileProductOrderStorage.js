class ProfileProductOrderStorage {
  static async create(conn, data) {
    const r = await conn.query(
      `INSERT INTO public.tb_profile_product_order (
         id_buyer_user, id_profile_product, id_seller_profile, id_seller_user,
         quantity, unit_price_cents, shipping_cents, total_cents,
         shipping_service_id, shipping_service_name, shipping_carrier,
         destination_zipcode, destination_full_address,
         buyer_name, buyer_email, buyer_whatsapp,
         stripe_session_id, status
       ) VALUES (
         $1,$2,$3,$4,
         $5,$6,$7,$8,
         $9,$10,$11,
         $12,$13,
         $14,$15,$16,
         $17,$18
       ) RETURNING *`,
      [
        data.id_buyer_user, data.id_profile_product, data.id_seller_profile, data.id_seller_user,
        data.quantity, data.unit_price_cents, data.shipping_cents, data.total_cents,
        data.shipping_service_id || null, data.shipping_service_name || null, data.shipping_carrier || null,
        data.destination_zipcode, data.destination_full_address ? JSON.stringify(data.destination_full_address) : null,
        data.buyer_name || null, data.buyer_email || null, data.buyer_whatsapp || null,
        data.stripe_session_id, data.status || "pending",
      ]
    );
    return r.rows[0];
  }

  static async getById(conn, id_order) {
    const r = await conn.query(
      `SELECT * FROM public.tb_profile_product_order WHERE id_order = $1 LIMIT 1`,
      [id_order]
    );
    return r.rows[0] || null;
  }

  static async getByStripeSession(conn, session_id) {
    const r = await conn.query(
      `SELECT * FROM public.tb_profile_product_order
        WHERE stripe_session_id = $1 LIMIT 1`,
      [session_id]
    );
    return r.rows[0] || null;
  }

  static async getByPaymentIntent(conn, pi) {
    const r = await conn.query(
      `SELECT * FROM public.tb_profile_product_order
        WHERE stripe_payment_intent_id = $1 LIMIT 1`,
      [pi]
    );
    return r.rows[0] || null;
  }

  static async markPaid(conn, id_order, { payment_intent_id, charge_id }) {
    const r = await conn.query(
      `UPDATE public.tb_profile_product_order
          SET status = 'paid',
              paid_at = NOW(),
              stripe_payment_intent_id = COALESCE($2, stripe_payment_intent_id),
              stripe_charge_id = COALESCE($3, stripe_charge_id),
              updated_at = NOW()
        WHERE id_order = $1
        RETURNING *`,
      [id_order, payment_intent_id || null, charge_id || null]
    );
    return r.rows[0] || null;
  }

  static async markCanceled(conn, id_order) {
    const r = await conn.query(
      `UPDATE public.tb_profile_product_order
          SET status = 'canceled', canceled_at = NOW(), updated_at = NOW()
        WHERE id_order = $1
        RETURNING *`,
      [id_order]
    );
    return r.rows[0] || null;
  }

  static async markRefunded(conn, id_order) {
    const r = await conn.query(
      `UPDATE public.tb_profile_product_order
          SET status = 'refunded', refunded_at = NOW(), updated_at = NOW()
        WHERE id_order = $1
        RETURNING *`,
      [id_order]
    );
    return r.rows[0] || null;
  }

  static async listForBuyer(conn, id_buyer_user, { limit = 50, offset = 0 } = {}) {
    const r = await conn.query(
      `SELECT o.*,
              pp.name AS product_name,
              (SELECT media_url FROM public.tb_profile_product_media m
                 WHERE m.id_profile_product = o.id_profile_product
                 ORDER BY m.sort_order ASC, m.id_product_media ASC LIMIT 1) AS product_cover_url,
              u.username AS seller_username,
              pr.display_name AS seller_display_name
         FROM public.tb_profile_product_order o
         JOIN public.tb_profile_product pp ON pp.id_profile_product = o.id_profile_product
         JOIN public.tb_profile pr ON pr.id_profile = o.id_seller_profile
         JOIN public.tb_user u ON u.id_user = o.id_seller_user
        WHERE o.id_buyer_user = $1
        ORDER BY o.created_at DESC
        LIMIT $2 OFFSET $3`,
      [id_buyer_user, limit, offset]
    );
    return r.rows;
  }
}

module.exports = ProfileProductOrderStorage;
