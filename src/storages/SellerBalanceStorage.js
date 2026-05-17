class SellerBalanceStorage {
  static async create(conn, data) {
    const r = await conn.query(
      `INSERT INTO public.tb_seller_balance (
         id_seller_user, id_seller_profile, id_order,
         gross_cents, platform_fee_cents, shipping_cents, net_cents,
         status, available_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id_order) DO NOTHING
       RETURNING *`,
      [
        data.id_seller_user, data.id_seller_profile, data.id_order,
        data.gross_cents, data.platform_fee_cents || 0,
        data.shipping_cents || 0, data.net_cents,
        data.status || "aguardando", data.available_at,
      ]
    );
    return r.rows[0] || null;
  }

  static async getById(conn, id_balance) {
    const r = await conn.query(
      `SELECT * FROM public.tb_seller_balance WHERE id_balance = $1 LIMIT 1`,
      [id_balance]
    );
    return r.rows[0] || null;
  }

  static async getByOrder(conn, id_order) {
    const r = await conn.query(
      `SELECT * FROM public.tb_seller_balance WHERE id_order = $1 LIMIT 1`,
      [id_order]
    );
    return r.rows[0] || null;
  }

  static async listForSeller(conn, id_seller_user, { status, limit = 100, offset = 0 } = {}) {
    const params = [id_seller_user];
    let where = "WHERE b.id_seller_user = $1";
    if (status) {
      params.push(status);
      where += ` AND b.status = $${params.length}`;
    }
    params.push(limit, offset);
    const r = await conn.query(
      `SELECT b.*,
              o.total_cents AS order_total_cents,
              o.status AS order_status,
              o.buyer_name,
              o.created_at AS order_created_at,
              o.label_pdf_url,
              o.label_purchased_at,
              o.label_purchase_error,
              o.label_purchase_attempts,
              o.melhor_envio_order_id,
              o.tracking_code,
              o.shipping_carrier,
              o.shipping_service_name,
              pp.name AS product_name,
              pr.display_name AS seller_display_name
         FROM public.tb_seller_balance b
         JOIN public.tb_profile_product_order o ON o.id_order = b.id_order
         JOIN public.tb_profile_product pp ON pp.id_profile_product = o.id_profile_product
         JOIN public.tb_profile pr ON pr.id_profile = b.id_seller_profile
         ${where}
         ORDER BY b.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return r.rows;
  }

  static async listAdmin(conn, { status, q, since, until, limit = 100, offset = 0 } = {}) {
    const params = [];
    const where = ["1=1"];
    if (status) { params.push(status); where.push(`b.status = $${params.length}`); }
    if (q) { params.push(`%${q}%`); where.push(`(u.username ILIKE $${params.length} OR u.email ILIKE $${params.length} OR pr.display_name ILIKE $${params.length})`); }
    if (since) { params.push(since); where.push(`b.created_at >= $${params.length}`); }
    if (until) { params.push(until); where.push(`b.created_at <= $${params.length}`); }
    params.push(limit, offset);
    const r = await conn.query(
      `SELECT b.*,
              o.total_cents AS order_total_cents,
              o.status AS order_status,
              pp.name AS product_name,
              pr.display_name AS seller_display_name,
              u.username AS seller_username,
              u.email AS seller_email
         FROM public.tb_seller_balance b
         JOIN public.tb_profile_product_order o ON o.id_order = b.id_order
         JOIN public.tb_profile_product pp ON pp.id_profile_product = o.id_profile_product
         JOIN public.tb_profile pr ON pr.id_profile = b.id_seller_profile
         JOIN public.tb_user u ON u.id_user = b.id_seller_user
         WHERE ${where.join(" AND ")}
         ORDER BY b.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return r.rows;
  }

  static async releaseDue(conn) {
    const r = await conn.query(
      `UPDATE public.tb_seller_balance
          SET status = 'aprovado', approved_at = NOW(), updated_at = NOW()
        WHERE status = 'aguardando' AND available_at <= NOW()
        RETURNING id_balance, id_seller_user`
    );
    return r.rows;
  }

  static async markPaidOut(conn, id_balance, { note } = {}) {
    const r = await conn.query(
      `UPDATE public.tb_seller_balance
          SET status = 'pago', paid_out_at = NOW(), paid_out_note = $2, updated_at = NOW()
        WHERE id_balance = $1 AND status = 'aprovado'
        RETURNING *`,
      [id_balance, note || null]
    );
    return r.rows[0] || null;
  }

  static async revertByOrder(conn, id_order) {
    const r = await conn.query(
      `UPDATE public.tb_seller_balance
          SET status = 'revertido', reverted_at = NOW(), updated_at = NOW()
        WHERE id_order = $1 AND status IN ('aguardando','aprovado')
        RETURNING *`,
      [id_order]
    );
    return r.rows[0] || null;
  }
}

module.exports = SellerBalanceStorage;
